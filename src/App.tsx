import { useState, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import './App.css'
import RouletteWheel from './RouletteWheel'
import PlinkoBoard from './PlinkoBoard'

interface Player {
  id: string;
  name: string;
  color: string;
  army: string;
}

interface Unit {
  id: string;
  x: number;
  y: number;
  playerId: string;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  targetId?: string;
  moving: boolean;
  unitType: string;
  size: number;
  attackRange: number;
  attackCooldown: number;
  lastAttackTime: number;
  chainLightningRange?: number; // Range for chain lightning
  chainLightningTargets?: number; // Number of targets for chain lightning
}

interface AttackAnimation {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  type: string; // 'projectile', 'melee', 'base'
  startTime: number;
  duration: number;
}

interface Trap {
  id: string;
  x: number;
  y: number;
  playerId: string;
  damage: number;
  triggered: boolean;
  type: string;
}

interface Turret {
  id: string;
  x: number;
  y: number;
  playerId: string;
  health: number;
  maxHealth: number;
  damage: number;
  attackRange: number;
  attackCooldown: number;
  lastAttackTime: number;
  type: string;
}

interface Mine {
  id: string;
  x: number;
  y: number;
  playerId: string;
  damage: number;
  explosionRadius: number;
  triggered: boolean;
  type: string;
}

interface GameState {
  players: Player[];
  units: Unit[];
  currentPlayer: number;
  gameOver: boolean;
  winner: Player | null;
  playerResources: { [playerId: string]: number };
  playerSelectedLane: { [playerId: string]: number };
  playerBases: { [playerId: string]: { health: number; maxHealth: number; x: number; y: number } };
  attackAnimations: AttackAnimation[];
  traps: Trap[];
  turrets: Turret[];
  mines: Mine[];
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>('disconnected');
  const [error, setError] = useState<string>('');
  const [gameId, setGameId] = useState<string>('');
  const [playerName, setPlayerName] = useState<string>('');
  const [serverIP, setServerIP] = useState<string>('localhost:3001');
  const [customServerEnabled, setCustomServerEnabled] = useState<boolean>(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerIndex, setPlayerIndex] = useState<number>(-1);
  const [plinkoReward, setPlinkoReward] = useState(0);
  const [placementMode, setPlacementMode] = useState<'trap' | 'turret' | 'mine'>('trap');
  const [activeTab, setActiveTab] = useState<'units' | 'defense' | 'info'>('units');
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 600 });
  const [isMinimized, setIsMinimized] = useState(false); // Keep as false by default
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Listen for maximize message from PlinkoBoard
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.action === 'maximizePlinko') {
        setIsMinimized(false);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Create floating particles effect
  useEffect(() => {
    const createParticles = () => {
      const particles = [];
      for (let i = 0; i < 20; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + 'vw';
        particle.style.animationDelay = Math.random() * 8 + 's';
        particle.style.animationDuration = (6 + Math.random() * 4) + 's';
        document.body.appendChild(particle);
        particles.push(particle);
        
        setTimeout(() => {
          if (particle.parentNode) {
            particle.parentNode.removeChild(particle);
          }
        }, 10000);
      }
    };

    createParticles();
    const interval = setInterval(createParticles, 3000);

    return () => {
      clearInterval(interval);
      // Clean up any remaining particles
      document.querySelectorAll('.particle').forEach(p => {
        if (p.parentNode) p.parentNode.removeChild(p);
      });
    };
  }, []);

  // Listen for maximize message from PlinkoBoard
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.action === 'maximizePlinko') {
        // Set game to maximized state
        setIsMinimized(false);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Handle window resize for responsive canvas
  useEffect(() => {
    const handleResize = () => {
      const maxWidth = window.innerWidth - 320; // Account for side panel
      const maxHeight = window.innerHeight - 20; // Account for padding
      setCanvasSize({
        width: Math.min(1200, maxWidth),
        height: Math.min(600, maxHeight)
      });
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial call
    
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    console.log('Setting up socket connection...');
    
    try {
      const newSocket = io(`http://${serverIP}`);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Connected to server');
        setConnectionStatus('connected');
        setError('');
      });

      newSocket.on('disconnect', () => {
        console.log('Disconnected from server');
        setConnectionStatus('disconnected');
      });

      newSocket.on('connect_error', (err) => {
        console.error('Connection error:', err);
        setError(`Connection failed: ${err.message}`);
        setConnectionStatus('error');
      });

      newSocket.on('game-joined', (data) => {
        console.log('Game joined:', data);
        if (data.success) {
          setGameState(data.game);
          setPlayerIndex(data.playerIndex);
        } else {
          alert(data.message);
        }
      });

      newSocket.on('game-updated', (data) => {
        console.log('Game updated:', data);
        console.log('Units count:', data.units?.length || 0);
        if (data.units && data.units.length > 0) {
          console.log('First unit position:', data.units[0].x, data.units[0].y);
        }
        setGameState(data);
      });

      newSocket.on('player-disconnected', (data) => {
        alert(`Player ${data.disconnectedPlayer + 1} disconnected`);
      });

      return () => {
        console.log('Cleaning up socket connection');
        newSocket.close();
      };
    } catch (err) {
      console.error('Error setting up socket:', err);
      setError(`Setup error: ${err}`);
    }
  }, [serverIP]);

  // Update server IP dynamically based on user input or environment
  useEffect(() => {
    const ip = '192.168.4.85'; // Replace with your local IP address
    const port = '3001'; // Replace with your server port
    setServerIP(`${ip}:${port}`);
  }, []);

  // Canvas rendering - only re-render when gameState or canvas size changes
  useEffect(() => {
    if (!gameState || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      // Calculate scaling factors based on standard 1200x600 game coordinates
      const STANDARD_WIDTH = 1200;
      const STANDARD_HEIGHT = 600;
      const scaleX = canvas.width / STANDARD_WIDTH;
      const scaleY = canvas.height / STANDARD_HEIGHT;

      // Apply scaling transformation
      ctx.save();
      ctx.scale(scaleX, scaleY);

      // Clear canvas (using standard dimensions since we're scaled)
      ctx.clearRect(0, 0, STANDARD_WIDTH, STANDARD_HEIGHT);
      
      // Draw battlefield background with enhanced effects
      const gradient = ctx.createLinearGradient(0, 0, STANDARD_WIDTH, STANDARD_HEIGHT);
      gradient.addColorStop(0, '#0a0a1a');
      gradient.addColorStop(0.3, '#1a0a2e');
      gradient.addColorStop(0.7, '#2d1b69');
      gradient.addColorStop(1, '#0a0a1a');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, STANDARD_WIDTH, STANDARD_HEIGHT);
      
      // Add energy grid pattern
      ctx.strokeStyle = 'rgba(131, 56, 236, 0.2)';
      ctx.lineWidth = 1;
      const gridSize = 50;
      for (let x = 0; x <= STANDARD_WIDTH; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, STANDARD_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y <= STANDARD_HEIGHT; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(STANDARD_WIDTH, y);
        ctx.stroke();
      }
      
      // Draw enhanced center line with glow effect
      const centerGradient = ctx.createLinearGradient(STANDARD_WIDTH / 2 - 10, 0, STANDARD_WIDTH / 2 + 10, 0);
      centerGradient.addColorStop(0, 'rgba(255, 0, 110, 0)');
      centerGradient.addColorStop(0.5, 'rgba(255, 0, 110, 0.8)');
      centerGradient.addColorStop(1, 'rgba(255, 0, 110, 0)');
      
      ctx.fillStyle = centerGradient;
      ctx.fillRect(STANDARD_WIDTH / 2 - 10, 0, 20, STANDARD_HEIGHT);
      
      ctx.strokeStyle = '#ff006e';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ff006e';
      ctx.shadowBlur = 15;
      ctx.setLineDash([15, 10]);
      ctx.beginPath();
      ctx.moveTo(STANDARD_WIDTH / 2, 0);
      ctx.lineTo(STANDARD_WIDTH / 2, STANDARD_HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Draw bases
      if (gameState.playerBases) {
        Object.entries(gameState.playerBases).forEach(([playerId, base]) => {
          const player = gameState.players.find(p => p.id === playerId);
          if (!player) return;

          ctx.fillStyle = player.color;
          ctx.fillRect(base.x - 20, base.y - 30, 40, 60);
          
          // === Draw base attack range circle ===
          const BASE_ATTACK_RANGE = 120;
          ctx.save();
          ctx.beginPath();
          ctx.arc(base.x, base.y, BASE_ATTACK_RANGE, 0, Math.PI * 2);
          ctx.strokeStyle = player.color;
          ctx.globalAlpha = 0.15;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.globalAlpha = 1.0;
          ctx.restore();
          // === End base attack range circle ===

          // Base health bar
          const healthPercent = base.health / base.maxHealth;
          ctx.fillStyle = 'red';
          ctx.fillRect(base.x - 20, base.y - 40, 40, 8);
          ctx.fillStyle = 'green';
          ctx.fillRect(base.x - 20, base.y - 40, 40 * healthPercent, 8);
        });
      }

      // Draw units with enhanced visuals
      if (gameState.units) {
        const now = Date.now();
        gameState.units.forEach(unit => {
          const player = gameState.players.find(p => p.id === unit.playerId);
          if (!player) return;

          const radius = unit.size || 12;
          
          ctx.save();

          // Unit-specific visual effects based on type
          if (unit.unitType === 'Peasant') {
            // Simple worker with tool effects
            ctx.fillStyle = player.color;
            ctx.shadowColor = player.color;
            ctx.shadowBlur = 2;
            ctx.beginPath();
            ctx.arc(unit.x, unit.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Tool animation
            const toolAngle = Math.sin(now * 0.01) * 0.3;
            ctx.strokeStyle = '#8B4513';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(unit.x + Math.cos(toolAngle) * (radius + 5), unit.y + Math.sin(toolAngle) * (radius + 5));
            ctx.lineTo(unit.x + Math.cos(toolAngle + Math.PI) * radius, unit.y + Math.sin(toolAngle + Math.PI) * radius);
            ctx.stroke();
            
          } else if (unit.unitType === 'Knight') {
            // Armored knight with metallic shine
            const gradient = ctx.createRadialGradient(unit.x - 3, unit.y - 3, 0, unit.x, unit.y, radius);
            gradient.addColorStop(0, '#C0C0C0');
            gradient.addColorStop(0.6, player.color);
            gradient.addColorStop(1, '#2C2C2C');
            
            ctx.fillStyle = gradient;
            ctx.shadowColor = '#C0C0C0';
            ctx.shadowBlur = 3;
            ctx.beginPath();
            ctx.arc(unit.x, unit.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Armor plating
            ctx.strokeStyle = '#E6E6E6';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(unit.x, unit.y, radius * 0.8, 0, Math.PI * 2);
            ctx.stroke();
            
            // Sword glint (reduced)
            const glintAngle = (now * 0.02) % (Math.PI * 2);
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#FFD700';
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.moveTo(unit.x + Math.cos(glintAngle) * (radius + 8), unit.y + Math.sin(glintAngle) * (radius + 8));
            ctx.lineTo(unit.x + Math.cos(glintAngle + Math.PI) * 4, unit.y + Math.sin(glintAngle + Math.PI) * 4);
            ctx.stroke();
            
          } else if (unit.unitType === 'Archer') {
            // Agile archer with bow effects
            ctx.fillStyle = player.color;
            ctx.shadowColor = '#228B22';
            ctx.shadowBlur = 3;
            ctx.beginPath();
            ctx.arc(unit.x, unit.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Bow
            const bowAngle = unit.moving ? Math.sin(now * 0.015) * 0.2 : 0;
            ctx.strokeStyle = '#8B4513';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(unit.x + 8, unit.y, radius * 0.8, bowAngle + Math.PI * 0.3, bowAngle + Math.PI * 1.7);
            ctx.stroke();
            
            // Quiver arrows
            for (let i = 0; i < 3; i++) {
              const arrowY = unit.y - radius + i * 3;
              ctx.strokeStyle = '#654321';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(unit.x - radius - 2, arrowY);
              ctx.lineTo(unit.x - radius + 4, arrowY);
              ctx.stroke();
            }
            
          } else if (unit.unitType === 'King') {
            // Majestic king with crown and aura (reduced glow)
            const auraRadius = radius + 6 + Math.sin(now * 0.008) * 2;
            const auraGradient = ctx.createRadialGradient(unit.x, unit.y, radius, unit.x, unit.y, auraRadius);
            auraGradient.addColorStop(0, 'rgba(255, 215, 0, 0)');
            auraGradient.addColorStop(1, 'rgba(255, 215, 0, 0.15)');
            
            // Majestic aura
            ctx.fillStyle = auraGradient;
            ctx.beginPath();
            ctx.arc(unit.x, unit.y, auraRadius, 0, Math.PI * 2);
            ctx.fill();
            
            // King body with royal gradient
            const royalGradient = ctx.createRadialGradient(unit.x - 4, unit.y - 4, 0, unit.x, unit.y, radius);
            royalGradient.addColorStop(0, '#FFD700');
            royalGradient.addColorStop(0.5, player.color);
            royalGradient.addColorStop(1, '#4B0082');
            
            ctx.fillStyle = royalGradient;
            ctx.shadowColor = '#FFD700';
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.arc(unit.x, unit.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Crown (reduced glow)
            for (let i = 0; i < 5; i++) {
              const crownAngle = (i * Math.PI * 2) / 5 - Math.PI / 2;
              const crownX = unit.x + Math.cos(crownAngle) * (radius - 2);
              const crownY = unit.y + Math.sin(crownAngle) * (radius - 2);
              ctx.fillStyle = '#FFD700';
              ctx.shadowColor = '#FFD700';
              ctx.shadowBlur = 3;
              ctx.beginPath();
              ctx.arc(crownX, crownY, 2, 0, Math.PI * 2);
              ctx.fill();
            }
            
          } else if (unit.unitType === 'Wizard') {
            // Enhanced wizard with reduced glow
            const energyPulse = Math.sin(now * 0.02) * 0.3 + 0.3;
            
            // Mystical energy field (reduced)
            const fieldGradient = ctx.createRadialGradient(unit.x, unit.y, 0, unit.x, unit.y, radius + 10);
            fieldGradient.addColorStop(0, `rgba(138, 43, 226, ${0.3 + energyPulse * 0.2})`);
            fieldGradient.addColorStop(0.6, `rgba(75, 0, 130, ${0.2 + energyPulse * 0.1})`);
            fieldGradient.addColorStop(1, 'rgba(138, 43, 226, 0)');
            
            ctx.fillStyle = fieldGradient;
            ctx.beginPath();
            ctx.arc(unit.x, unit.y, radius + 10, 0, Math.PI * 2);
            ctx.fill();
            
            // Wizard body with magical gradient
            const wizardGradient = ctx.createRadialGradient(unit.x - 3, unit.y - 3, 0, unit.x, unit.y, radius);
            wizardGradient.addColorStop(0, '#E6E6FA');
            wizardGradient.addColorStop(0.5, '#8A2BE2');
            wizardGradient.addColorStop(1, '#4B0082');
            
            ctx.fillStyle = wizardGradient;
            ctx.shadowColor = '#8A2BE2';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(unit.x, unit.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // Floating magical orbs
            for (let i = 0; i < 4; i++) {
              const orbAngle = (now * 0.003 + i * Math.PI / 2) % (Math.PI * 2);
              const orbDistance = radius + 12 + Math.sin(now * 0.01 + i) * 4;
              const orbX = unit.x + Math.cos(orbAngle) * orbDistance;
              const orbY = unit.y + Math.sin(orbAngle) * orbDistance;
              
              ctx.fillStyle = '#E6E6FA';
              ctx.shadowColor = '#E6E6FA';
              ctx.shadowBlur = 8;
              ctx.beginPath();
              ctx.arc(orbX, orbY, 3, 0, Math.PI * 2);
              ctx.fill();
            }
            
            // Staff
            const staffAngle = Math.sin(now * 0.005) * 0.1;
            ctx.strokeStyle = '#8B4513';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(unit.x + Math.cos(staffAngle) * (radius + 15), unit.y + Math.sin(staffAngle) * (radius + 15));
            ctx.lineTo(unit.x + Math.cos(staffAngle + Math.PI) * 8, unit.y + Math.sin(staffAngle + Math.PI) * 8);
            ctx.stroke();
            
            // Staff crystal
            ctx.fillStyle = '#00FFFF';
            ctx.shadowColor = '#00FFFF';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(unit.x + Math.cos(staffAngle) * (radius + 15), unit.y + Math.sin(staffAngle) * (radius + 15), 4, 0, Math.PI * 2);
            ctx.fill();
          }

          // Enhanced border based on unit type
          let borderColor = '#fff';
          let borderWidth = 2;
          
          if (unit.unitType === 'Knight') {
            borderColor = '#C0C0C0';
            borderWidth = 3;
          } else if (unit.unitType === 'King') {
            borderColor = '#FFD700';
            borderWidth = 4;
          } else if (unit.unitType === 'Wizard') {
            borderColor = '#8A2BE2';
            borderWidth = 3;
          } else if (unit.unitType === 'Archer') {
            borderColor = '#228B22';
            borderWidth = 2;
          }
          
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = borderWidth;
          ctx.shadowColor = borderColor;
          ctx.shadowBlur = 5;
          ctx.beginPath();
          ctx.arc(unit.x, unit.y, radius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.restore();

          // Enhanced attack range visualization
          ctx.save();
          ctx.strokeStyle = player.color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.15;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(unit.x, unit.y, unit.attackRange, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1.0;
          ctx.restore();

          // Enhanced health bar with unit-specific styling
          const healthPercent = unit.health / unit.maxHealth;
          const barWidth = radius * 2.2;
          const barHeight = 5;
          const barY = unit.y - radius - 12;
          
          // Health bar background with glow
          ctx.save();
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 3;
          ctx.fillStyle = '#222';
          ctx.fillRect(unit.x - barWidth/2, barY, barWidth, barHeight);
          
          // Health bar fill with gradient
          let healthColor;
          if (healthPercent > 0.6) {
            healthColor = '#4CAF50';
          } else if (healthPercent > 0.3) {
            healthColor = '#FFC107';
          } else {
            healthColor = '#F44336';
          }
          
          const healthGradient = ctx.createLinearGradient(unit.x - barWidth/2, barY, unit.x + barWidth/2, barY);
          healthGradient.addColorStop(0, healthColor);
          healthGradient.addColorStop(1, `${healthColor}80`);
          
          ctx.fillStyle = healthGradient;
          ctx.shadowColor = healthColor;
          ctx.shadowBlur = 5;
          ctx.fillRect(unit.x - barWidth/2, barY, barWidth * healthPercent, barHeight);
          ctx.restore();

          // Enhanced unit type indicator with special effects
          ctx.save();
          ctx.fillStyle = 'white';
          ctx.font = `bold ${Math.max(10, radius - 1)}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 2;
          
          let unitSymbol = unit.unitType.charAt(0);
          if (unit.unitType === 'Knight') unitSymbol = '⚔';
          else if (unit.unitType === 'Archer') unitSymbol = '🏹';
          else if (unit.unitType === 'King') unitSymbol = '👑';
          else if (unit.unitType === 'Wizard') unitSymbol = '🔮';
          else if (unit.unitType === 'Peasant') unitSymbol = '⚒';
          
          ctx.fillText(unitSymbol, unit.x, unit.y);
          ctx.restore();

          // Movement trail effect
          if (unit.moving) {
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = player.color;
            for (let i = 1; i <= 3; i++) {
              const trailX = unit.x - (unit.speed * i * 3);
              const trailRadius = radius * (0.8 - i * 0.1);
              ctx.beginPath();
              ctx.arc(trailX, unit.y, trailRadius, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          }
        });
      }

      // Draw enhanced attack animations
      if (gameState.attackAnimations) {
        const now = Date.now();
        gameState.attackAnimations.forEach(anim => {
          const elapsed = now - anim.startTime;
          const progress = Math.min(elapsed / anim.duration, 1);
          
          if (progress < 1) {
            // Calculate current position
            const currentX = anim.fromX + (anim.toX - anim.fromX) * progress;
            const currentY = anim.fromY + (anim.toY - anim.fromY) * progress;
            
            // Enhanced animation types with unit-specific effects
            if (anim.type === 'projectile') {
              // Determine unit type from animation context for enhanced effects
              ctx.save();
              
              // Enhanced arrow/projectile with trail
              const projectileGradient = ctx.createRadialGradient(currentX, currentY, 0, currentX, currentY, 8);
              projectileGradient.addColorStop(0, '#FFFFFF');
              projectileGradient.addColorStop(0.5, '#FFD700');
              projectileGradient.addColorStop(1, '#FF8C00');
              
              ctx.fillStyle = projectileGradient;
              ctx.shadowColor = '#FFD700';
              ctx.shadowBlur = 15;
              ctx.beginPath();
              ctx.arc(currentX, currentY, 5 + Math.sin(now * 0.02) * 1, 0, Math.PI * 2);
              ctx.fill();
              
              // Sparkling trail effect
              const trailLength = 20;
              for (let i = 0; i < trailLength; i++) {
                const trailProgress = progress - (i * 0.05);
                if (trailProgress > 0) {
                  const trailX = anim.fromX + (anim.toX - anim.fromX) * trailProgress;
                  const trailY = anim.fromY + (anim.toY - anim.fromY) * trailProgress;
                  const sparkleSize = (1 - i / trailLength) * 3;
                  const sparkleAlpha = (1 - i / trailLength) * 0.8;
                  
                  ctx.fillStyle = `rgba(255, 215, 0, ${sparkleAlpha})`;
                  ctx.shadowBlur = 8;
                  ctx.beginPath();
                  ctx.arc(trailX + Math.sin(now * 0.05 + i) * 2, trailY + Math.cos(now * 0.05 + i) * 2, sparkleSize, 0, Math.PI * 2);
                  ctx.fill();
                }
              }
              
              // Energy streaks
              ctx.strokeStyle = '#FFFF00';
              ctx.lineWidth = 2;
              ctx.shadowColor = '#FFFF00';
              ctx.shadowBlur = 10;
              ctx.globalAlpha = 0.7;
              ctx.beginPath();
              ctx.moveTo(anim.fromX, anim.fromY);
              ctx.lineTo(currentX, currentY);
              ctx.stroke();
              
              ctx.restore();
              
            } else if (anim.type === 'melee') {
              // Enhanced melee attack with sword slash effect
              ctx.save();
              
              // Sword slash arc
              const slashRadius = 25 * (1 - progress);
              const slashGradient = ctx.createRadialGradient(anim.toX, anim.toY, 0, anim.toX, anim.toY, slashRadius);
              slashGradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
              slashGradient.addColorStop(0.5, 'rgba(192, 192, 192, 0.6)');
              slashGradient.addColorStop(1, 'rgba(255, 68, 68, 0.3)');
              
              ctx.fillStyle = slashGradient;
              ctx.shadowColor = '#C0C0C0';
              ctx.shadowBlur = 20;
              ctx.globalAlpha = 1 - progress;
              ctx.beginPath();
              ctx.arc(anim.toX, anim.toY, slashRadius, 0, Math.PI * 2);
              ctx.fill();
              
              // Metallic sparks
              for (let i = 0; i < 8; i++) {
                const sparkAngle = (i * Math.PI) / 4 + progress * Math.PI * 0.5;
                const sparkDistance = 15 + Math.random() * 10;
                const sparkX = anim.toX + Math.cos(sparkAngle) * sparkDistance;
                const sparkY = anim.toY + Math.sin(sparkAngle) * sparkDistance;
                
                ctx.fillStyle = '#FFFFFF';
                ctx.shadowColor = '#FFFFFF';
                ctx.shadowBlur = 8;
                ctx.globalAlpha = (1 - progress) * 0.8;
                ctx.beginPath();
                ctx.arc(sparkX, sparkY, 2, 0, Math.PI * 2);
                ctx.fill();
              }
              
              // Sword glint line
              const glintAngle = Math.atan2(anim.toY - anim.fromY, anim.toX - anim.fromX) + Math.PI / 4;
              ctx.strokeStyle = '#FFD700';
              ctx.lineWidth = 4;
              ctx.shadowColor = '#FFD700';
              ctx.shadowBlur = 15;
              ctx.globalAlpha = (1 - progress) * 0.9;
              ctx.beginPath();
              ctx.moveTo(anim.toX + Math.cos(glintAngle) * 20, anim.toY + Math.sin(glintAngle) * 20);
              ctx.lineTo(anim.toX - Math.cos(glintAngle) * 20, anim.toY - Math.sin(glintAngle) * 20);
              ctx.stroke();
              
              ctx.restore();
              
            } else if (anim.type === 'base') {
              // Enhanced base cannon shot with energy effects
              ctx.save();
              
              // Energy orb projectile
              const orbGradient = ctx.createRadialGradient(currentX, currentY, 0, currentX, currentY, 10);
              orbGradient.addColorStop(0, '#FFFFFF');
              orbGradient.addColorStop(0.4, '#00FF00');
              orbGradient.addColorStop(1, '#008800');
              
              ctx.fillStyle = orbGradient;
              ctx.shadowColor = '#00FF00';
              ctx.shadowBlur = 20;
              ctx.beginPath();
              ctx.arc(currentX, currentY, 8 + Math.sin(now * 0.03) * 2, 0, Math.PI * 2);
              ctx.fill();
              
              // Energy crackling around the orb
              for (let i = 0; i < 6; i++) {
                const crackleAngle = (now * 0.02 + i * Math.PI / 3) % (Math.PI * 2);
                const crackleDistance = 12 + Math.sin(now * 0.025 + i) * 4;
                const crackleX = currentX + Math.cos(crackleAngle) * crackleDistance;
                const crackleY = currentY + Math.sin(crackleAngle) * crackleDistance;
                
                ctx.fillStyle = '#CCFFCC';
                ctx.shadowColor = '#CCFFCC';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(crackleX, crackleY, 1.5, 0, Math.PI * 2);
                ctx.fill();
              }
              
              // Charged energy trail
              ctx.strokeStyle = '#00FF00';
              ctx.lineWidth = 4;
              ctx.shadowColor = '#00FF00';
              ctx.shadowBlur = 15;
              ctx.globalAlpha = 0.8;
              ctx.beginPath();
              ctx.moveTo(anim.fromX, anim.fromY);
              ctx.lineTo(currentX, currentY);
              ctx.stroke();
              
              // Secondary trail
              ctx.strokeStyle = '#88FF88';
              ctx.lineWidth = 2;
              ctx.shadowBlur = 10;
              ctx.globalAlpha = 0.6;
              ctx.beginPath();
              ctx.moveTo(anim.fromX, anim.fromY);
              ctx.lineTo(currentX, currentY);
              ctx.stroke();
              
              ctx.restore();
              
            } else if (anim.type === 'explosion') {
              // Enhanced trap explosion with debris
              ctx.save();
              
              const explosionRadius = 35 * progress;
              const explosionGradient = ctx.createRadialGradient(anim.fromX, anim.fromY, 0, anim.fromX, anim.fromY, explosionRadius);
              explosionGradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
              explosionGradient.addColorStop(0.3, 'rgba(255, 165, 0, 0.8)');
              explosionGradient.addColorStop(0.7, 'rgba(255, 69, 0, 0.6)');
              explosionGradient.addColorStop(1, 'rgba(139, 69, 19, 0.2)');
              
              ctx.fillStyle = explosionGradient;
              ctx.shadowColor = '#FF8800';
              ctx.shadowBlur = 30;
              ctx.globalAlpha = 1 - progress;
              ctx.beginPath();
              ctx.arc(anim.fromX, anim.fromY, explosionRadius, 0, Math.PI * 2);
              ctx.fill();
              
              // Flying debris
              for (let i = 0; i < 12; i++) {
                const debrisAngle = (i * Math.PI * 2) / 12;
                const debrisDistance = progress * 40;
                const debrisX = anim.fromX + Math.cos(debrisAngle) * debrisDistance;
                const debrisY = anim.fromY + Math.sin(debrisAngle) * debrisDistance;
                
                ctx.fillStyle = '#8B4513';
                ctx.shadowColor = '#8B4513';
                ctx.shadowBlur = 5;
                ctx.globalAlpha = (1 - progress) * 0.7;
                ctx.beginPath();
                ctx.arc(debrisX, debrisY, 2 + Math.random() * 2, 0, Math.PI * 2);
                ctx.fill();
              }
              
              ctx.restore();
              
            } else if (anim.type === 'mine_explosion') {
              // Enhanced mine explosion with shockwave
              ctx.save();
              
              const mineRadius = 60 * progress;
              const shockwaveRadius = 80 * progress;
              
              // Main explosion
              const mineGradient = ctx.createRadialGradient(anim.fromX, anim.fromY, 0, anim.fromX, anim.fromY, mineRadius);
              mineGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
              mineGradient.addColorStop(0.2, 'rgba(255, 0, 0, 0.9)');
              mineGradient.addColorStop(0.6, 'rgba(255, 140, 0, 0.7)');
              mineGradient.addColorStop(1, 'rgba(139, 0, 0, 0.3)');
              
              ctx.fillStyle = mineGradient;
              ctx.shadowColor = '#FF0000';
              ctx.shadowBlur = 40;
              ctx.globalAlpha = 1 - progress;
              ctx.beginPath();
              ctx.arc(anim.fromX, anim.fromY, mineRadius, 0, Math.PI * 2);
              ctx.fill();
              
              // Shockwave rings
              for (let ring = 0; ring < 3; ring++) {
                const ringProgress = Math.max(0, (progress - ring * 0.1) / 0.7);
                if (ringProgress > 0) {
                  ctx.strokeStyle = `rgba(255, 0, 0, ${(1 - ringProgress) * 0.6})`;
                  ctx.lineWidth = 4 - ring;
                  ctx.shadowColor = '#FF0000';
                  ctx.shadowBlur = 20;
                  ctx.beginPath();
                  ctx.arc(anim.fromX, anim.fromY, shockwaveRadius * ringProgress, 0, Math.PI * 2);
                  ctx.stroke();
                }
              }
              
              // Explosive particles
              for (let i = 0; i < 20; i++) {
                const particleAngle = Math.random() * Math.PI * 2;
                const particleDistance = progress * (30 + Math.random() * 40);
                const particleX = anim.fromX + Math.cos(particleAngle) * particleDistance;
                const particleY = anim.fromY + Math.sin(particleAngle) * particleDistance;
                
                ctx.fillStyle = Math.random() > 0.5 ? '#FF4444' : '#FFAA00';
                ctx.shadowColor = ctx.fillStyle;
                ctx.shadowBlur = 8;
                ctx.globalAlpha = (1 - progress) * 0.8;
                ctx.beginPath();
                ctx.arc(particleX, particleY, 2 + Math.random() * 3, 0, Math.PI * 2);
                ctx.fill();
              }
              
              ctx.restore();
              
            } else if (anim.type === 'turret') {
              // Enhanced turret laser with energy effects
              ctx.save();
              
              // Main laser beam
              const laserGradient = ctx.createLinearGradient(anim.fromX, anim.fromY, currentX, currentY);
              laserGradient.addColorStop(0, 'rgba(0, 255, 255, 0.9)');
              laserGradient.addColorStop(0.5, 'rgba(0, 255, 255, 0.7)');
              laserGradient.addColorStop(1, 'rgba(0, 188, 255, 0.5)');
              
              ctx.strokeStyle = laserGradient;
              ctx.lineWidth = 6;
              ctx.shadowColor = '#00FFFF';
              ctx.shadowBlur = 20;
              ctx.beginPath();
              ctx.moveTo(anim.fromX, anim.fromY);
              ctx.lineTo(currentX, currentY);
              ctx.stroke();
              
              // Secondary beam
              ctx.strokeStyle = '#FFFFFF';
              ctx.lineWidth = 2;
              ctx.shadowBlur = 15;
              ctx.beginPath();
              ctx.moveTo(anim.fromX, anim.fromY);
              ctx.lineTo(currentX, currentY);
              ctx.stroke();
              
              // Traveling energy orb
              const orbGradient = ctx.createRadialGradient(currentX, currentY, 0, currentX, currentY, 8);
              orbGradient.addColorStop(0, '#FFFFFF');
              orbGradient.addColorStop(0.5, '#00FFFF');
              orbGradient.addColorStop(1, '#0088FF');
              
              ctx.fillStyle = orbGradient;
              ctx.shadowColor = '#00FFFF';
              ctx.shadowBlur = 15;
              ctx.beginPath();
              ctx.arc(currentX, currentY, 6 + Math.sin(now * 0.04) * 2, 0, Math.PI * 2);
              ctx.fill();
              
              // Energy crackling
              for (let i = 0; i < 4; i++) {
                const crackleX = currentX + (Math.random() - 0.5) * 16;
                const crackleY = currentY + (Math.random() - 0.5) * 16;
                
                ctx.fillStyle = '#CCFFFF';
                ctx.shadowColor = '#CCFFFF';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(crackleX, crackleY, 1, 0, Math.PI * 2);
                ctx.fill();
              }
              
              ctx.restore();
              
            } else if (anim.type === 'chain_lightning') {
              // Enhanced chain lightning animation 
              ctx.save();
              
              // Create animated lightning path
              const segments = 8;
              const points = [];
              const maxOffset = 15;
              const animTime = Date.now();
              
              for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const baseX = anim.fromX + (anim.toX - anim.fromX) * t;
                const baseY = anim.fromY + (anim.toY - anim.fromY) * t;
                
                // Animated zigzag
                const offsetX = Math.sin(animTime * 0.025 + i * 0.8) * maxOffset * (1 - Math.abs(t - 0.5) * 2);
                const offsetY = Math.cos(animTime * 0.02 + i * 0.9) * maxOffset * (1 - Math.abs(t - 0.5) * 2);
                
                points.push({ x: baseX + offsetX, y: baseY + offsetY });
              }
              
              // Draw multiple lightning strokes
              for (let stroke = 0; stroke < 4; stroke++) {
                if (stroke === 0) {
                  ctx.strokeStyle = '#FFFFFF';
                  ctx.lineWidth = 4;
                  ctx.shadowColor = '#FFFFFF';
                  ctx.shadowBlur = 20;
                } else if (stroke === 1) {
                  ctx.strokeStyle = '#00FFFF';
                  ctx.lineWidth = 3;
                  ctx.shadowColor = '#00FFFF';
                  ctx.shadowBlur = 15;
                } else if (stroke === 2) {
                  ctx.strokeStyle = '#88DDFF';
                  ctx.lineWidth = 2;
                  ctx.shadowColor = '#88DDFF';
                  ctx.shadowBlur = 10;
                } else {
                  ctx.strokeStyle = '#CCCCFF';
                  ctx.lineWidth = 1;
                  ctx.shadowColor = '#CCCCFF';
                  ctx.shadowBlur = 8;
                }
                
                ctx.globalAlpha = (1 - progress) * (0.8 + Math.sin(animTime * 0.03) * 0.2);
                
                ctx.beginPath();
                points.forEach((point, i) => {
                  if (i === 0) {
                    ctx.moveTo(point.x, point.y);
                  } else {
                    ctx.lineTo(point.x, point.y);
                  }
                });
                ctx.stroke();
              }
              
              // Lightning impact effect
              ctx.fillStyle = '#00FFFF';
              ctx.shadowColor = '#00FFFF';
              ctx.shadowBlur = 20;
              ctx.globalAlpha = (1 - progress) * 0.9;
              ctx.beginPath();
              ctx.arc(anim.toX, anim.toY, 10 * (1 - progress), 0, Math.PI * 2);
              ctx.fill();
              
              ctx.restore();
              
            } else if (anim.type === 'aura_boost') {
              // King aura buff effect
              ctx.save();
              
              const auraRadius = 25 + Math.sin(elapsed * 0.01) * 5;
              const auraGradient = ctx.createRadialGradient(anim.fromX, anim.fromY, 0, anim.fromX, anim.fromY, auraRadius);
              auraGradient.addColorStop(0, 'rgba(255, 215, 0, 0.8)');
              auraGradient.addColorStop(0.6, 'rgba(255, 215, 0, 0.4)');
              auraGradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
              
              ctx.fillStyle = auraGradient;
              ctx.globalAlpha = (1 - progress) * 0.7;
              ctx.beginPath();
              ctx.arc(anim.fromX, anim.fromY, auraRadius, 0, Math.PI * 2);
              ctx.fill();
              
              // Floating golden particles
              for (let i = 0; i < 8; i++) {
                const particleAngle = (elapsed * 0.01 + i * Math.PI / 4) % (Math.PI * 2);
                const particleDistance = 15 + Math.sin(elapsed * 0.02 + i) * 8;
                const particleX = anim.fromX + Math.cos(particleAngle) * particleDistance;
                const particleY = anim.fromY + Math.sin(particleAngle) * particleDistance;
                
                ctx.fillStyle = '#FFD700';
                ctx.shadowColor = '#FFD700';
                ctx.shadowBlur = 10;
                ctx.globalAlpha = (1 - progress) * 0.8;
                ctx.beginPath();
                ctx.arc(particleX, particleY, 2, 0, Math.PI * 2);
                ctx.fill();
              }
              
              ctx.restore();
              
            } else if (anim.type === 'critical_hit') {
              // Archer critical hit effect
              ctx.save();
              
              // Critical strike flash
              const flashGradient = ctx.createRadialGradient(anim.toX, anim.toY, 0, anim.toX, anim.toY, 30);
              flashGradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
              flashGradient.addColorStop(0.5, 'rgba(255, 0, 0, 0.7)');
              flashGradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
              
              ctx.fillStyle = flashGradient;
              ctx.globalAlpha = (1 - progress) * 0.8;
              ctx.beginPath();
              ctx.arc(anim.toX, anim.toY, 30 * (1 - progress), 0, Math.PI * 2);
              ctx.fill();
              
              // Critical damage text effect
              if (progress < 0.6) {
                ctx.fillStyle = '#FF0000';
                ctx.font = 'bold 16px Arial';
                ctx.textAlign = 'center';
                ctx.shadowColor = '#FFFFFF';
                ctx.shadowBlur = 5;
                ctx.globalAlpha = (0.6 - progress) / 0.6;
                ctx.fillText('CRIT!', anim.toX, anim.toY - 20 - progress * 30);
              }
              
              // Star burst effect
              for (let i = 0; i < 6; i++) {
                const starAngle = (i * Math.PI) / 3;
                const starLength = 20 * (1 - progress);
                const starX = anim.toX + Math.cos(starAngle) * starLength;
                const starY = anim.toY + Math.sin(starAngle) * starLength;
                
                ctx.strokeStyle = '#FFFF00';
                ctx.lineWidth = 3;
                ctx.shadowColor = '#FFFF00';
                ctx.shadowBlur = 8;
                ctx.globalAlpha = (1 - progress) * 0.7;
                ctx.beginPath();
                ctx.moveTo(anim.toX, anim.toY);
                ctx.lineTo(starX, starY);
                ctx.stroke();
              }
              
              ctx.restore();
            }
          }
        });
      }

      // Draw traps
      if (gameState.traps) {
        gameState.traps.forEach(trap => {
          if (!trap.triggered) {
            const player = gameState.players.find(p => p.id === trap.playerId);
            if (!player) return;

            // Draw trap as a spiky circle
            ctx.save();
            ctx.fillStyle = player.color;
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 2;
            
            // Draw spiky trap shape
            ctx.beginPath();
            const spikes = 8;
            const outerRadius = 12;
            const innerRadius = 6;
            
            for (let i = 0; i < spikes * 2; i++) {
              const angle = (i * Math.PI) / spikes;
              const radius = i % 2 === 0 ? outerRadius : innerRadius;
              const x = trap.x + Math.cos(angle) * radius;
              const y = trap.y + Math.sin(angle) * radius;
              
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
            
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Add a danger symbol in the center
            ctx.fillStyle = '#FFD700';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('!', trap.x, trap.y + 4);
            
            ctx.restore();
          }
        });
      }

      // Draw turrets
      if (gameState.turrets) {
        gameState.turrets.forEach(turret => {
          const player = gameState.players.find(p => p.id === turret.playerId);
          if (!player) return;

          // Draw turret body (rectangular base)
          ctx.save();
          ctx.fillStyle = player.color;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 2;
          ctx.fillRect(turret.x - 15, turret.y - 15, 30, 30);
          ctx.strokeRect(turret.x - 15, turret.y - 15, 30, 30);
          
          // Draw turret cannon
          ctx.fillStyle = '#666';
          ctx.fillRect(turret.x - 3, turret.y - 20, 6, 25);
          
          // Draw attack range circle (semi-transparent)
          ctx.strokeStyle = player.color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.1;
          ctx.beginPath();
          ctx.arc(turret.x, turret.y, turret.attackRange, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1.0;

          // Turret health bar
          const healthPercent = turret.health / turret.maxHealth;
          const barWidth = 30;
          const barHeight = 4;
          const barY = turret.y - 25;
          
          // Health bar background
          ctx.fillStyle = '#333';
          ctx.fillRect(turret.x - barWidth/2, barY, barWidth, barHeight);
          
          // Health bar fill
          ctx.fillStyle = healthPercent > 0.5 ? '#4CAF50' : healthPercent > 0.25 ? '#FFC107' : '#F44336';
          ctx.fillRect(turret.x - barWidth/2, barY, barWidth * healthPercent, barHeight);

          // Turret symbol
          ctx.fillStyle = 'white';
          ctx.font = '12px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('T', turret.x, turret.y + 4);
          
          ctx.restore();
        });
      }

      // Draw mines
      if (gameState.mines) {
        gameState.mines.forEach(mine => {
          if (!mine.triggered) {
            const player = gameState.players.find(p => p.id === mine.playerId);
            if (!player) return;

            // Draw mine as a circular shape with warning pattern
            ctx.save();
            ctx.fillStyle = player.color;
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 2;
            
            // Draw mine circle
            ctx.beginPath();
            ctx.arc(mine.x, mine.y, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            // Draw explosion radius indicator (very faint)
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.05;
            ctx.beginPath();
            ctx.arc(mine.x, mine.y, mine.explosionRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1.0;
            
            // Add warning symbol
            ctx.fillStyle = '#FFD700';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('M', mine.x, mine.y + 3);
            
            ctx.restore();
          }
        });
      }

      // Highlight selected lane
      if (playerIndex >= 0 && gameState && gameState.playerSelectedLane) {
        const lane = gameState.playerSelectedLane[gameState.players[playerIndex].id] || 0;
        const laneHeight = canvas.height / 3;
        ctx.save();
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 5;
        ctx.strokeRect(0, lane * laneHeight, canvas.width, laneHeight);
        ctx.restore();
      }

      // Draw enhanced chain lightning effect
      if (gameState.units) {
        const now = Date.now();
        gameState.units.forEach((unit) => {
          if (unit.unitType === 'Wizard' && unit.chainLightningRange !== undefined) {
            const targets = gameState.units
              .filter((target) => target.playerId !== unit.playerId)
              .filter(
                (target) =>
                  Math.hypot(target.x - unit.x, target.y - unit.y) <= (unit.chainLightningRange || 0)
              )
              .slice(0, unit.chainLightningTargets || 3);

            // Energy buildup effect before lightning
            const energyPulse = Math.sin(now * 0.02) * 0.5 + 0.5;
            
            // Wizard energy orb
            ctx.save();
            const orbRadius = 15 + energyPulse * 10;
            const gradient = ctx.createRadialGradient(unit.x, unit.y, 0, unit.x, unit.y, orbRadius);
            gradient.addColorStop(0, `rgba(138, 43, 226, ${0.8 + energyPulse * 0.2})`);
            gradient.addColorStop(0.6, `rgba(75, 0, 130, ${0.4 + energyPulse * 0.3})`);
            gradient.addColorStop(1, 'rgba(138, 43, 226, 0)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(unit.x, unit.y, orbRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            targets.forEach((target, index) => {
              const delay = index * 200; // Stagger chain lightning
              const adjustedTime = now - delay;
              
              if (adjustedTime > 0) {
                // Create enhanced animated lightning bolt with branching
                const drawEnhancedLightning = (fromX: number, fromY: number, toX: number, toY: number, intensity: number = 1) => {
                  const segments = 12;
                  const points = [];
                  const maxOffset = 20 * intensity;
                  
                  // Create main lightning path
                  for (let i = 0; i <= segments; i++) {
                    const t = i / segments;
                    const baseX = fromX + (toX - fromX) * t;
                    const baseY = fromY + (toY - fromY) * t;
                    
                    // Enhanced zigzag with multiple frequency components
                    const offsetX = (
                      Math.sin(adjustedTime * 0.015 + i * 0.8) * maxOffset * (1 - Math.abs(t - 0.5) * 1.5) +
                      Math.sin(adjustedTime * 0.03 + i * 1.2) * maxOffset * 0.3
                    );
                    const offsetY = (
                      Math.cos(adjustedTime * 0.012 + i * 0.9) * maxOffset * (1 - Math.abs(t - 0.5) * 1.5) +
                      Math.cos(adjustedTime * 0.025 + i * 1.5) * maxOffset * 0.3
                    );
                    
                    points.push({ x: baseX + offsetX, y: baseY + offsetY });
                  }
                  
                  return points;
                };

                const lightningPoints = drawEnhancedLightning(unit.x, unit.y, target.x, target.y);
                
                // Draw multiple lightning layers with different effects
                for (let stroke = 0; stroke < 5; stroke++) {
                  ctx.save();
                  
                  const strokeIntensity = Math.sin(adjustedTime * 0.03 + stroke) * 0.3 + 0.7;
                  
                  if (stroke === 0) {
                    // Core white lightning
                    ctx.strokeStyle = '#FFFFFF';
                    ctx.lineWidth = 6;
                    ctx.shadowColor = '#FFFFFF';
                    ctx.shadowBlur = 30;
                    ctx.globalAlpha = strokeIntensity;
                  } else if (stroke === 1) {
                    // Bright cyan layer
                    ctx.strokeStyle = '#00FFFF';
                    ctx.lineWidth = 4;
                    ctx.shadowColor = '#00FFFF';
                    ctx.shadowBlur = 25;
                    ctx.globalAlpha = strokeIntensity * 0.8;
                  } else if (stroke === 2) {
                    // Electric blue layer
                    ctx.strokeStyle = '#0088FF';
                    ctx.lineWidth = 2;
                    ctx.shadowColor = '#0088FF';
                    ctx.shadowBlur = 20;
                    ctx.globalAlpha = strokeIntensity * 0.6;
                  } else if (stroke === 3) {
                    // Purple energy layer
                    ctx.strokeStyle = '#8A2BE2';
                    ctx.lineWidth = 1;
                    ctx.shadowColor = '#8A2BE2';
                    ctx.shadowBlur = 15;
                    ctx.globalAlpha = strokeIntensity * 0.4;
                  } else {
                    // Outer glow
                    ctx.strokeStyle = '#DDDDFF';
                    ctx.lineWidth = 8;
                    ctx.shadowColor = '#DDDDFF';
                    ctx.shadowBlur = 40;
                    ctx.globalAlpha = strokeIntensity * 0.2;
                  }
                  
                  ctx.beginPath();
                  lightningPoints.forEach((point, i) => {
                    if (i === 0) {
                      ctx.moveTo(point.x, point.y);
                    } else {
                      ctx.lineTo(point.x, point.y);
                    }
                  });
                  ctx.stroke();
                  
                  ctx.restore();
                }
                
                // Add branching lightning bolts
                if (Math.random() < 0.3) {
                  const midPoint = lightningPoints[Math.floor(lightningPoints.length / 2)];
                  const branchAngle = Math.random() * Math.PI * 2;
                  const branchLength = 30 + Math.random() * 40;
                  const branchEndX = midPoint.x + Math.cos(branchAngle) * branchLength;
                  const branchEndY = midPoint.y + Math.sin(branchAngle) * branchLength;
                  
                  const branchPoints = drawEnhancedLightning(midPoint.x, midPoint.y, branchEndX, branchEndY, 0.5);
                  
                  ctx.save();
                  ctx.strokeStyle = '#00FFFF';
                  ctx.lineWidth = 2;
                  ctx.shadowColor = '#00FFFF';
                  ctx.shadowBlur = 15;
                  ctx.globalAlpha = 0.6;
                  
                  ctx.beginPath();
                  branchPoints.forEach((point, i) => {
                    if (i === 0) {
                      ctx.moveTo(point.x, point.y);
                    } else {
                      ctx.lineTo(point.x, point.y);
                    }
                  });
                  ctx.stroke();
                  ctx.restore();
                }
                
                // Enhanced electrical impact at target
                ctx.save();
                const impactIntensity = Math.sin(adjustedTime * 0.04) * 0.5 + 0.5;
                
                // Shockwave rings
                for (let ring = 0; ring < 3; ring++) {
                  const ringRadius = (10 + ring * 8) * (1 + impactIntensity * 0.5);
                  const ringAlpha = (0.6 - ring * 0.2) * impactIntensity;
                  
                  ctx.shadowColor = '#00FFFF';
                  ctx.shadowBlur = 20;
                  
                  ctx.beginPath();
                  ctx.arc(target.x, target.y, ringRadius, 0, Math.PI * 2);
                  ctx.stroke();
                }
                
                // Electrical particle burst
                for (let particle = 0; particle < 12; particle++) {
                  const particleAngle = (adjustedTime * 0.02 + particle * Math.PI / 6) % (Math.PI * 2);
                  const particleDistance = 15 + Math.sin(adjustedTime * 0.02 + particle) * 10;
                  const particleX = target.x + Math.cos(particleAngle) * particleDistance;
                  const particleY = target.y + Math.sin(particleAngle) * particleDistance;
                  const particleSize = 1 + Math.sin(adjustedTime * 0.03 + particle) * 1.5;
                  
                  ctx.fillStyle = particle % 2 === 0 ? '#FFFFFF' : '#00FFFF';
                  ctx.shadowColor = ctx.fillStyle;
                  ctx.shadowBlur = 10;
                  
                  ctx.beginPath();
                  ctx.arc(particleX, particleY, particleSize, 0, Math.PI * 2);
                  ctx.fill();
                }
                
                // Lightning impact flash
                const flashIntensity = Math.max(0, Math.sin(adjustedTime * 0.1) * 0.3);
                if (flashIntensity > 0) {
                  const flashGradient = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, 40);
                  flashGradient.addColorStop(0, `rgba(255, 255, 255, ${flashIntensity})`);
                  flashGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                  
                  ctx.fillStyle = flashGradient;
                  ctx.beginPath();
                  ctx.arc(target.x, target.y, 40, 0, Math.PI * 2);
                  ctx.fill();
                }
                
                ctx.restore();
              }
            });
            
            // Enhanced wizard casting effect with magical geometry
            ctx.save();
            
            // Magical energy rings with different rotations
            for (let ring = 0; ring < 3; ring++) {
              const ringRadius = 20 + ring * 12 + Math.sin(now * 0.01 + ring) * 4;
              const ringRotation = (now * (0.003 + ring * 0.002)) % (Math.PI * 2);
              const ringAlpha = 0.4 + Math.sin(now * 0.01 + ring * 2) * 0.3;
              
              ctx.strokeStyle = `rgba(138, 43, 226, ${ringAlpha})`;
              ctx.lineWidth = 2;
              ctx.shadowColor = '#8A2BE2';
              ctx.shadowBlur = 15;
              
              // Draw magical geometric pattern
              ctx.beginPath();
              for (let side = 0; side < 6; side++) {
                const angle = ringRotation + (side * Math.PI) / 3;
                const x = unit.x + Math.cos(angle) * ringRadius;
                const y = unit.y + Math.sin(angle) * ringRadius;
                
                if (side === 0) {
                  ctx.moveTo(x, y);
                } else {
                  ctx.lineTo(x, y);
                }
              }
              ctx.closePath();
              ctx.stroke();
            }
            
            // Floating magical runes with enhanced animation
            for (let rune = 0; rune < 8; rune++) {
              const runeAngle = (now * 0.004 + rune * Math.PI / 4) % (Math.PI * 2);
              const runeDistance = 35 + Math.sin(now * 0.008 + rune) * 8;
              const runeX = unit.x + Math.cos(runeAngle) * runeDistance;
              const runeY = unit.y + Math.sin(runeAngle) * runeDistance;
              const runeScale = 0.8 + Math.sin(now * 0.012 + rune) * 0.4;
              
              ctx.save();
              ctx.translate(runeX, runeY);
              ctx.scale(runeScale, runeScale);
              ctx.rotate(runeAngle);
              
              ctx.fillStyle = '#8A2BE2';
              ctx.shadowColor = '#8A2BE2';
              ctx.shadowBlur = 10;
              ctx.font = '16px Arial';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              
              const runes = ['✦', '⚡', '◊', '※', '✧', '⬟', '◈', '⬢'];
              ctx.fillText(runes[rune], 0, 0);
              
              ctx.restore();
            }
            
            // Energy streams connecting to targets
            targets.forEach((target, index) => {
              const streamAlpha = 0.3 + Math.sin(now * 0.01 + index) * 0.2;
              ctx.strokeStyle = `rgba(138, 43, 226, ${streamAlpha})`;
              ctx.lineWidth = 1;
              ctx.shadowColor = '#8A2BE2';
              ctx.shadowBlur = 8;
              
              ctx.beginPath();
              ctx.moveTo(unit.x, unit.y);
              ctx.lineTo(target.x, target.y);
              ctx.stroke();
            });
            
            ctx.restore();
          }
        });
      }
      
      // Restore the scaling transformation
      ctx.restore();
    } catch (err) {
      console.error('Canvas rendering error:', err);
    }
  }, [gameState, canvasSize]); // Re-render whenever gameState or canvas size changes

  const joinGame = () => {
    console.log('Joining game:', { gameId, playerName });
    if (socket && gameId && playerName) {
      socket.emit('join-game', { gameId, playerName });
    } else {
      console.log('Missing data:', { socket: !!socket, gameId, playerName });
    }
  };

  const spawnUnit = (unitType: string) => {
    if (socket && gameId && gameState && playerIndex >= 0) {
      const myResources = gameState.playerResources[gameState.players[playerIndex].id] || 0;
      const unitCosts: { [key: string]: number } = { 
        Peasant: 25, 
        Knight: 150, 
        Archer: 350, 
        King: 500, 
        Wizard: 400 // Cost for Wizard
      };
      if (myResources >= (unitCosts[unitType] || 0)) {
        socket.emit('spawn-unit', { 
          gameId, 
          unitType, 
          lane: getMySelectedLane() // Send selected lane
        });
      }
    }
  };

  const placeTrap = (x: number, y: number) => {
    if (socket && gameId && gameState && playerIndex >= 0) {
      const myResources = gameState.playerResources[gameState.players[playerIndex].id] || 0;
      const TRAP_COST = 50;
      if (myResources >= TRAP_COST) {
        socket.emit('place-trap', { gameId, x, y });
      }
    }
  };

  const placeTurret = (x: number, y: number) => {
    if (socket && gameId && gameState && playerIndex >= 0) {
      const myResources = gameState.playerResources[gameState.players[playerIndex].id] || 0;
      const TURRET_COST = 125;
      if (myResources >= TURRET_COST) {
        socket.emit('place-turret', { gameId, x, y });
      }
    }
  };

  const placeMine = (x: number, y: number) => {
    if (socket && gameId && gameState && playerIndex >= 0) {
      const myResources = gameState.playerResources[gameState.players[playerIndex].id] || 0;
      const MINE_COST = 75;
      if (myResources >= MINE_COST) {
        socket.emit('place-mine', { gameId, x, y });
      }
    }
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !gameState || playerIndex < 0) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    
    // Convert canvas display coordinates to actual canvas coordinates
    const canvasX = (clickX / rect.width) * canvas.width;
    const canvasY = (clickY / rect.height) * canvas.height;
    
    // Convert canvas coordinates to game coordinates (1200x600 standard)
    const STANDARD_WIDTH = 1200;
    const STANDARD_HEIGHT = 600;
    const scaleX = canvas.width / STANDARD_WIDTH;
    const scaleY = canvas.height / STANDARD_HEIGHT;
    
    const gameX = canvasX / scaleX;
    const gameY = canvasY / scaleY;
    
    // Check if click is on player's own half using standard game dimensions
    const playerHalfStart = playerIndex === 0 ? 0 : STANDARD_WIDTH / 2;
    const playerHalfEnd = playerIndex === 0 ? STANDARD_WIDTH / 2 : STANDARD_WIDTH;
    
    if (gameX >= playerHalfStart && gameX <= playerHalfEnd) {
      // Place structure based on current placement mode using game coordinates
      if (placementMode === 'trap') {
        placeTrap(gameX, gameY);
      } else if (placementMode === 'turret') {
        placeTurret(gameX, gameY);
      } else if (placementMode === 'mine') {
        placeMine(gameX, gameY);
      }
    }
  };



  const LANES = [0, 1, 2];

  const selectLane = (lane: number) => {
    if (socket && gameId && gameState && playerIndex >= 0) {
      socket.emit('select-lane', { gameId, lane });
    }
  };

  const getMySelectedLane = () => {
    if (
      !gameState ||
      playerIndex < 0 ||
      !gameState.playerSelectedLane ||
      !gameState.players[playerIndex]
    ) return 0;
    return gameState.playerSelectedLane[gameState.players[playerIndex].id] || 0;
  };

  const mySelectedLane = getMySelectedLane();

  const getMyResources = () => {
    if (!gameState || playerIndex < 0) return 0;
    return gameState.playerResources[gameState.players[playerIndex].id] || 0;
  };

  const getMyBaseHealth = () => {
    if (!gameState || playerIndex < 0) return { health: 0, maxHealth: 0 };
    const myBase = gameState.playerBases[gameState.players[playerIndex].id];
    return myBase || { health: 0, maxHealth: 0 };
  };

  const getProduction = () => {
    if (!gameState) return 0;
    // All players share the same production rate (from server)
    // If you want to show per-player, adjust accordingly
    // The server sends resourceGenerationRate as a property of the game, so you need to add it to GameState and server getGameState()
    // For now, just hardcode 25 or show a placeholder if not available
    // If you want to show the real value, see the note below
    return (gameState as any).resourceGenerationRate || 25;
  };

  // Debug info
  console.log('Render state:', { 
    gameState: !!gameState, 
    playerIndex, 
    connectionStatus,
    error 
  });
  
  // Toggle game minimize/maximize state
  const toggleGameMinimized = () => {
    setIsMinimized(prev => !prev);
  };
  
  return (
    <div className={`app ${isMinimized ? 'game-minimized' : 'game-maximized'}`}>
      {/* Plinko Board as interactive background */}
      <PlinkoBoard 
        playerResources={gameState ? getMyResources() : 0}
        onReward={(multiplier, amount) => {
          if (gameState && playerIndex >= 0) {
            // Handle both costs and winnings
            socket?.emit('plinko-reward', {
              gameId,
              playerId: gameState.players[playerIndex].id,
              multiplier,
              amount
            });
          }
        }}
      />
      
      {/* Minimize/Maximize Button - only show when in game */}
      {gameState && (
        <button 
          className="minimize-button" 
          onClick={toggleGameMinimized}
          title={isMinimized ? "Maximize Game" : "Minimize Game"}
        >
          {isMinimized ? '⬆️' : '⬇️'}
        </button>
      )}
      {/* Main game UI overlayed above Plinko */}
      {!gameState ? (
        <div className="join-screen">
          <div className="join-header">
            <h1>Battle Arena</h1>
            {error && (
              <div style={{color: 'red', padding: '0.5rem', background: '#ffe6e6', border: '1px solid red', borderRadius: '0.5rem', margin: '0.5rem 0', fontSize: '0.9rem'}}>
                Error: {error}
              </div>
            )}
            <div className="connection-status" style={{fontSize: '0.9rem', padding: '0.25rem 0.5rem'}}>
              Status: {connectionStatus}
            </div>
          </div>
          
          <div className="join-form">
            <input
              type="text"
              placeholder="Your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
            />
            <input
              type="text"
              placeholder="Game ID (any text)"
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
            />
            <button onClick={joinGame} disabled={connectionStatus !== 'connected'}>
              Join Game
            </button>
          </div>
          <p className="instructions">
            Enter a game ID to create or join a battle. Share the same game ID with your friend to fight together!
          </p>
        </div>
      ) : (
        <div className="game-container">
          <div className="side-panel">
            <div className="game-header-compact hologram-effect">
              <div className="game-title">⚔️ Battle Arena</div>
            </div>
            <div className="game-info-compact">
              <h2>Battle: {gameId}</h2>
              <div className="players-compact">
                {gameState.players.map((player, index) => (
                  <div key={player.id} className={`player-compact ${index === playerIndex ? 'you' : ''}`}>
                    {player.name} {index === playerIndex && '(You)'}
                  </div>
                ))}
                {gameState.players.length < 2 && (
                  <div className="waiting-compact">Waiting...</div>
                )}
              </div>
              
              {gameState.players.length === 2 && (
                <div className="game-stats-compact">
                  <div className="stat-compact">💰 {getMyResources()}</div>
                  <div className="stat-compact">⚡ {getProduction()}/s</div>
                  <div className="stat-compact">🏰 {getMyBaseHealth().health}/{getMyBaseHealth().maxHealth}</div>
                  <div className="stat-compact">📍 Lane {getMySelectedLane()+1}</div>
                </div>
              )}
            </div>            
            {gameState.players.length === 2 && !gameState.gameOver && (
              <div className="control-panel-compact">
                <div className="tab-navigation-compact">
                  <button 
                    className={`tab-btn-compact ${activeTab === 'units' ? 'active' : ''}`}
                    onClick={() => setActiveTab('units')}
                  >
                    ⚔️
                  </button>
                  <button 
                    className={`tab-btn-compact ${activeTab === 'defense' ? 'active' : ''}`}
                    onClick={() => setActiveTab('defense')}
                  >
                    🛡️
                  </button>
                  <button 
                    className={`tab-btn-compact ${activeTab === 'info' ? 'active' : ''}`}
                    onClick={() => setActiveTab('info')}
                  >
                    📊
                  </button>
                </div>

                <div className="tab-content-compact">
                  {activeTab === 'units' && (
                    <div className="units-tab-compact">
                      <div className="unit-list-compact">
                        <div className="unit-item-compact">
                          <span className="unit-name-compact">⚒️ Peasant</span>
                          <span className="unit-cost-compact">25</span>
                          <button 
                            className="deploy-btn-compact" 
                            onClick={() => spawnUnit('Peasant')}
                            disabled={getMyResources() < 25}
                          >
                            Deploy
                          </button>
                        </div>
                        
                        <div className="unit-item-compact">
                          <span className="unit-name-compact">⚔️ Knight</span>
                          <span className="unit-cost-compact">150</span>
                          <button 
                            className="deploy-btn-compact" 
                            onClick={() => spawnUnit('Knight')}
                            disabled={getMyResources() < 150}
                          >
                            Deploy
                          </button>
                        </div>
                        
                        <div className="unit-item-compact">
                          <span className="unit-name-compact">🏹 Archer</span>
                          <span className="unit-cost-compact">350</span>
                          <button 
                            className="deploy-btn-compact" 
                            onClick={() => spawnUnit('Archer')}
                            disabled={getMyResources() < 350}
                          >
                            Deploy
                          </button>
                        </div>
                        
                        <div className="unit-item-compact">
                          <span className="unit-name-compact">👑 King</span>
                          <span className="unit-cost-compact">500</span>
                          <button 
                            className="deploy-btn-compact" 
                            onClick={() => spawnUnit('King')}
                            disabled={getMyResources() < 500}
                          >
                            Deploy
                          </button>
                        </div>
                        
                        <div className="unit-item-compact">
                          <span className="unit-name-compact">🔮 Wizard</span>
                          <span className="unit-cost-compact">400</span>
                          <button 
                            className="deploy-btn-compact" 
                            onClick={() => spawnUnit('Wizard')}
                            disabled={getMyResources() < 400}
                          >
                            Deploy
                          </button>
                        </div>
                      </div>
                      
                      <div className="lane-selector-compact">
                        <div className="lane-label-compact">Lane:</div>
                        <div className="lane-buttons-compact">
                          {LANES.map((lane) => (
                            <button
                              key={lane}
                              className={`lane-btn-compact${mySelectedLane === lane ? ' selected' : ''}`}
                              onClick={() => selectLane(lane)}
                            >
                              {lane + 1}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'defense' && (
                    <div className="defense-tab-compact">
                      <div className="defense-info-compact">
                        🎯 Click battlefield to place {placementMode}s
                      </div>
                      
                      <div className="defense-list-compact">
                        <div className={`defense-item-compact ${placementMode === 'trap' ? 'selected' : ''}`}>
                          <span className="defense-name-compact">🕳️ Trap</span>
                          <span className="defense-cost-compact">50</span>
                          <button 
                            className="defense-btn-compact" 
                            onClick={() => setPlacementMode('trap')}
                          >
                            {placementMode === 'trap' ? '✓' : 'Select'}
                          </button>
                        </div>
                        
                        <div className={`defense-item-compact ${placementMode === 'turret' ? 'selected' : ''}`}>
                          <span className="defense-name-compact">🗼 Turret</span>
                          <span className="defense-cost-compact">125</span>
                          <button 
                            className="defense-btn-compact" 
                            onClick={() => setPlacementMode('turret')}
                          >
                            {placementMode === 'turret' ? '✓' : 'Select'}
                          </button>
                        </div>
                        
                        <div className={`defense-item-compact ${placementMode === 'mine' ? 'selected' : ''}`}>
                          <span className="defense-name-compact">💣 Mine</span>
                          <span className="defense-cost-compact">75</span>
                          <button 
                            className="defense-btn-compact" 
                            onClick={() => setPlacementMode('mine')}
                          >
                            {placementMode === 'mine' ? '✓' : 'Select'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'info' && (
                    <div className="info-tab-compact">
                      <div className="info-section-compact">
                        <h4>Abilities</h4>
                        <div className="ability-list-compact">
                          <div>🛡️ Knight: -20% damage</div>
                          <div>🎯 Archer: +15% crit</div>
                          <div>👑 King: +30% aura</div>
                          <div>⚡ Wizard: Chain lightning</div>
                        </div>
                      </div>
                      
                      <div className="info-section-compact">
                        <h4>Stats</h4>
                        <div>Production: {getProduction()}/s</div>
                        <div>Units: {gameState.units.filter(u => u.playerId === gameState.players[playerIndex]?.id).length}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {gameState.gameOver && (
              <div className="game-over-compact">
                <button className="reset-btn-compact" onClick={() => socket?.emit('reset-game', { gameId })}>
                  🔄 New Battle
                </button>
              </div>
            )}
          </div>
          
          <div className="battlefield-container">
            <canvas 
              ref={canvasRef} 
              width={canvasSize.width} 
              height={canvasSize.height} 
              className="battlefield-compact hologram-effect"
              onClick={handleCanvasClick}
              style={{ cursor: activeTab === 'defense' ? 'crosshair' : 'default' }}
            />
          </div>
        </div>
      )}
      
      {/* Roulette Wheel - always visible when in game */}
      {gameState && (
        <RouletteWheel 
          playerResources={getMyResources()}
          onSpin={(result, winnings) => {
            if (winnings > 0) {
              socket?.emit('roulette-win', { 
                gameId, 
                playerId: gameState.players[playerIndex].id, 
                winnings 
              });
            }
          }}
          onBet={(betAmount, betType, betValue) => {
            socket?.emit('roulette-bet', { 
              gameId, 
              playerId: gameState.players[playerIndex].id, 
              betAmount 
            });
          }}
        />
      )}
    </div>
  );
}

export default App;
