import { useState, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import './App.css'
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

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
  chainLightningRange?: number;
  chainLightningTargets?: number;
}

interface AttackAnimation {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  type: string;
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
  level: number;
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
  level: number;
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
  level: number;
}

interface Castle {
  health: number;
  maxHealth: number;
  x: number;
  y: number;
  level: number;
  weaponType: 'basic' | 'trebuchet' | 'wizard' | 'arrows';
  damage: number;
  attackRange: number;
  attackCooldown: number;
  lastAttackTime: number;
  unlockedWeapons: string[];
}

interface GameState {
  players: Player[];
  units: Unit[];
  currentPlayer: number;
  gameOver: boolean;
  winner: Player | null;
  playerResources: { [playerId: string]: number };
  playerSelectedLane: { [playerId: string]: number };
  playerBases: { [playerId: string]: Castle };
  attackAnimations: AttackAnimation[];
  traps: Trap[];
  turrets: Turret[];
  mines: Mine[];
  playerPowerups?: { [playerId: string]: any };
  resourceGenerationRate?: number;
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameId, setGameId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerIndex, setPlayerIndex] = useState<number>(-1);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [error, setError] = useState<string>('');
  const [placementMode, setPlacementMode] = useState<'trap' | 'turret' | 'mine'>('trap');
  const [activeTab, setActiveTab] = useState<'units' | 'defense' | 'info' | 'castle' | 'powerups'>('units');  const [selectedTurret, setSelectedTurret] = useState<string | null>(null);
  const [selectedTrap, setSelectedTrap] = useState<string | null>(null);
  const [selectedMine, setSelectedMine] = useState<string | null>(null);
  const [selectedCastle, setSelectedCastle] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');
  const [showToast, setShowToast] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Constants
  const LANES = [0, 1, 2];

  // Toast notification function
  const showToastNotification = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 3000); // Show for 3 seconds
  };

  useEffect(() => {
    console.log('Setting up socket connection...');
    
    try {
      const newSocket = io('http://localhost:3001');
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
      });      newSocket.on('player-disconnected', (data) => {
        alert(`Player ${data.disconnectedPlayer + 1} disconnected`);
      });      newSocket.on('castle-upgraded', (data) => {
        if (data.success) {
          showToastNotification('🏰 Castle upgraded successfully! New abilities unlocked!', 'success');
        } else {
          showToastNotification('❌ Failed to upgrade castle. Not enough resources.', 'error');
        }
      });

      newSocket.on('castle-weapon-changed', (data) => {
        if (data.success) {
          showToastNotification('⚔️ Castle weapon changed successfully! Your defenses are stronger!', 'success');
        } else {
          showToastNotification('❌ Failed to change castle weapon. Not enough resources.', 'error');
        }
      });

      newSocket.on('turret-upgraded', (data) => {
        if (data.success) {
          showToastNotification('🚀 Turret upgraded successfully! Increased damage and range!', 'success');        } else {
          showToastNotification('❌ Failed to upgrade turret. Not enough resources.', 'error');
        }
      });

      newSocket.on('powerup-purchased', () => {
        // No notification - silent purchase
      });

      newSocket.on('trap-upgraded', (data) => {
        if (data.success) {
          showToastNotification('⚠️ Trap upgraded successfully! Increased damage!', 'success');
        } else {
          showToastNotification('❌ Failed to upgrade trap. Not enough resources.', 'error');
        }
      });

      newSocket.on('mine-upgraded', (data) => {
        if (data.success) {
          showToastNotification('💣 Mine upgraded successfully! Increased damage and blast radius!', 'success');
        } else {
          showToastNotification('❌ Failed to upgrade mine. Not enough resources.', 'error');
        }
      });

      return () => {
        console.log('Cleaning up socket connection');
        newSocket.close();
      };
    } catch (err) {
      console.error('Error setting up socket:', err);
      setError(`Setup error: ${err}`);
    }
  }, []);
  // Helper functions
  const lerp = (start: number, end: number, progress: number): number => {
    return start + (end - start) * progress;
  };

  const getMyResources = (): number => {
    if (!gameState || playerIndex < 0) return 0;
    const playerId = gameState.players[playerIndex]?.id;
    return gameState.playerResources[playerId] || 0;
  };
  const getProduction = (): number => {
    if (!gameState || playerIndex < 0) return 0;
    // Use the server's resource generation rate which increases over time
    return gameState.resourceGenerationRate || 10;
  };const getMyBaseHealth = () => {
    if (!gameState || playerIndex < 0) return { 
      health: 100, 
      maxHealth: 100, 
      level: 1, 
      weaponType: 'basic' as const, 
      unlockedWeapons: ['basic'], 
      damage: 10, 
      attackRange: 120, 
      attackCooldown: 1200, 
      lastAttackTime: 0, 
      x: 0, 
      y: 0 
    };
    const playerId = gameState.players[playerIndex]?.id;
    return gameState.playerBases[playerId] || { 
      health: 100, 
      maxHealth: 100, 
      level: 1, 
      weaponType: 'basic' as const, 
      unlockedWeapons: ['basic'], 
      damage: 10, 
      attackRange: 120, 
      attackCooldown: 1200, 
      lastAttackTime: 0, 
      x: 0, 
      y: 0 
    };
  };

  const upgradeCastle = () => {
    if (socket && gameId) {
      socket.emit('upgrade-castle', { gameId });
    }
  };

  const changeCastleWeapon = (weaponType: 'basic' | 'trebuchet' | 'wizard' | 'arrows') => {
    if (socket && gameId) {
      socket.emit('change-castle-weapon', { gameId, weaponType });
    }
  };

  const getMySelectedLane = (): number => {
    if (!gameState || playerIndex < 0) return 0;
    const playerId = gameState.players[playerIndex]?.id;
    return gameState.playerSelectedLane[playerId] || 0;
  };

  const selectLane = (lane: number) => {
    if (socket && gameId) {
      socket.emit('select-lane', { gameId, lane });
    }
  };

  // Canvas rendering - only re-render when gameState changes
  useEffect(() => {
    if (!gameState || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw battlefield background
      ctx.fillStyle = '#2d4a22';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw center line
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);      // Draw bases
      if (gameState.playerBases) {
        Object.entries(gameState.playerBases).forEach(([playerId, base]) => {
          const player = gameState.players.find(p => p.id === playerId);
          if (!player) return;

          ctx.save();

          // Base size and appearance based on level
          let baseWidth = 40 + (base.level * 8);
          let baseHeight = 60 + (base.level * 12);
          let baseColor = player.color;

          // Weapon-specific styling
          if (base.weaponType === 'trebuchet') {
            baseColor = '#8B4513'; // Brown for trebuchet
            ctx.fillStyle = baseColor;
            ctx.fillRect(base.x - baseWidth/2, base.y - baseHeight/2, baseWidth, baseHeight);
            
            // Trebuchet arm
            ctx.strokeStyle = '#654321';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(base.x, base.y - baseHeight/4);
            ctx.lineTo(base.x - 10, base.y - baseHeight/2 - 15);
            ctx.stroke();
            
            // Boulder
            ctx.fillStyle = '#888';
            ctx.beginPath();
            ctx.arc(base.x - 10, base.y - baseHeight/2 - 20, 5, 0, Math.PI * 2);
            ctx.fill();
            
          } else if (base.weaponType === 'wizard') {
            // Magic tower
            const towerGradient = ctx.createRadialGradient(base.x, base.y, 0, base.x, base.y, baseWidth/2);
            towerGradient.addColorStop(0, '#8A2BE2');
            towerGradient.addColorStop(1, '#4B0082');
            
            ctx.fillStyle = towerGradient;
            ctx.beginPath();
            ctx.arc(base.x, base.y, baseWidth/2, 0, Math.PI * 2);
            ctx.fill();
            
            // Magic crystal on top
            ctx.fillStyle = '#00FFFF';
            ctx.shadowColor = '#00FFFF';
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.arc(base.x, base.y - baseHeight/2 - 10, 8, 0, Math.PI * 2);
            ctx.fill();
            
            // Floating orbs
            const now = Date.now();
            for (let i = 0; i < 4; i++) {
              const orbAngle = (now * 0.002 + i * Math.PI / 2) % (Math.PI * 2);
              const orbDistance = baseWidth/2 + 15;
              const orbX = base.x + Math.cos(orbAngle) * orbDistance;
              const orbY = base.y + Math.sin(orbAngle) * orbDistance;
              
              ctx.fillStyle = '#FF69B4';
              ctx.shadowColor = '#FF69B4';
              ctx.shadowBlur = 10;
              ctx.beginPath();
              ctx.arc(orbX, orbY, 4, 0, Math.PI * 2);
              ctx.fill();
            }
            
          } else if (base.weaponType === 'arrows') {
            // Multi-arrow tower
            ctx.fillStyle = '#228B22';
            ctx.fillRect(base.x - baseWidth/2, base.y - baseHeight/2, baseWidth, baseHeight);
            
            // Multiple arrow slots
            for (let i = 0; i < 5; i++) {
              const arrowX = base.x - 15 + (i * 7);
              const arrowY = base.y - baseHeight/2 - 10;
              ctx.strokeStyle = '#8B4513';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(arrowX, arrowY);
              ctx.lineTo(arrowX + 3, arrowY - 8);
              ctx.stroke();
            }
            
          } else {
            // Basic castle
            ctx.fillStyle = baseColor;
            ctx.fillRect(base.x - baseWidth/2, base.y - baseHeight/2, baseWidth, baseHeight);
            
            // Basic battlements
            ctx.fillStyle = baseColor;
            for (let i = 0; i < 5; i++) {
              const crenelX = base.x - baseWidth/2 + (i * baseWidth/4);
              if (i % 2 === 0) {
                ctx.fillRect(crenelX, base.y - baseHeight/2 - 8, baseWidth/5, 8);
              }
            }
          }

          // Level indicator
          ctx.fillStyle = '#FFD700';
          ctx.font = 'bold 14px Arial';
          ctx.textAlign = 'center';
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 2;
          ctx.fillText(`L${base.level}`, base.x, base.y - baseHeight/2 - 25);

          // Weapon type indicator
          let weaponIcon = '🏹';
          if (base.weaponType === 'trebuchet') weaponIcon = '🏰';
          else if (base.weaponType === 'wizard') weaponIcon = '🔮';
          else if (base.weaponType === 'arrows') weaponIcon = '🎯';
          
          ctx.fillStyle = 'white';
          ctx.font = '16px Arial';
          ctx.fillText(weaponIcon, base.x, base.y + 5);

          // Selection highlight
          if (selectedCastle && playerId === gameState.players[playerIndex]?.id) {
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 4;
            ctx.strokeRect(base.x - baseWidth/2 - 5, base.y - baseHeight/2 - 5, baseWidth + 10, baseHeight + 10);
          }
          
          // Draw base attack range circle
          const BASE_ATTACK_RANGE = base.attackRange || 120;
          ctx.beginPath();
          ctx.arc(base.x, base.y, BASE_ATTACK_RANGE, 0, Math.PI * 2);
          ctx.strokeStyle = player.color;
          ctx.globalAlpha = 0.15;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.globalAlpha = 1.0;

          // Base health bar
          const healthPercent = base.health / base.maxHealth;
          const barWidth = baseWidth + 10;
          const barHeight = 8;
          const barY = base.y - baseHeight/2 - 40;
          
          ctx.fillStyle = 'red';
          ctx.fillRect(base.x - barWidth/2, barY, barWidth, barHeight);
          ctx.fillStyle = 'green';
          ctx.fillRect(base.x - barWidth/2, barY, barWidth * healthPercent, barHeight);

          ctx.restore();
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
              // Enhanced arrow/projectile with trail
              ctx.save();
              
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
              
              ctx.restore();
              
            } else if (anim.type === 'melee') {
              // Enhanced melee attack with sword slash effect
              ctx.save();
              
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
              
              ctx.restore();
              
            } else if (anim.type === 'archer_arrow') {
              // Archer arrow projectile - more refined than castle arrows
              ctx.save();
              
              // Arrow shaft with fletching
              const angle = Math.atan2(anim.toY - anim.fromY, anim.toX - anim.fromX);
              ctx.strokeStyle = '#8B4513';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(anim.fromX, anim.fromY);
              ctx.lineTo(currentX, currentY);
              ctx.stroke();
              
              // Arrow head
              ctx.fillStyle = '#C0C0C0';
              ctx.save();
              ctx.translate(currentX, currentY);
              ctx.rotate(angle);
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(-8, -3);
              ctx.lineTo(-6, 0);
              ctx.lineTo(-8, 3);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
              
              // Fletching
              ctx.strokeStyle = '#228B22';
              ctx.lineWidth = 1;
              ctx.save();
              ctx.translate(currentX, currentY);
              ctx.rotate(angle);
              ctx.beginPath();
              ctx.moveTo(-15, -2);
              ctx.lineTo(-12, -1);
              ctx.moveTo(-15, 2);
              ctx.lineTo(-12, 1);
              ctx.stroke();
              ctx.restore();
              
              ctx.restore();
              
            } else if (anim.type === 'castle_arrow') {
              // Castle arrow projectile
              ctx.save();
              
              // Arrow shaft
              ctx.strokeStyle = '#8B4513';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.moveTo(anim.fromX, anim.fromY);
              ctx.lineTo(currentX, currentY);
              ctx.stroke();
              
              // Arrow head
              const angle = Math.atan2(anim.toY - anim.fromY, anim.toX - anim.fromX);
              ctx.fillStyle = '#FFD700';
              ctx.save();
              ctx.translate(currentX, currentY);
              ctx.rotate(angle);
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(-10, -4);
              ctx.lineTo(-10, 4);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
              
              ctx.restore();
              
            } else if (anim.type === 'castle_boulder') {
              // Trebuchet boulder projectile
              ctx.save();
              
              // Boulder with shadow
              ctx.fillStyle = '#8B7355';
              ctx.shadowColor = '#654321';
              ctx.shadowBlur = 8;
              ctx.beginPath();
              ctx.arc(currentX, currentY, 12, 0, Math.PI * 2);
              ctx.fill();
              
              // Boulder texture
              ctx.fillStyle = '#A0522D';
              ctx.beginPath();
              ctx.arc(currentX - 3, currentY - 3, 3, 0, Math.PI * 2);
              ctx.fill();
              ctx.beginPath();
              ctx.arc(currentX + 2, currentY + 2, 2, 0, Math.PI * 2);
              ctx.fill();
              
              // Trailing dust
              for (let i = 0; i < 5; i++) {
                const dustProgress = (progress + i * 0.2) % 1;
                const dustX = lerp(anim.fromX, currentX, dustProgress - 0.1);
                const dustY = lerp(anim.fromY, currentY, dustProgress - 0.1);
                ctx.fillStyle = `rgba(139, 115, 85, ${0.3 * (1 - dustProgress)})`;
                ctx.beginPath();
                ctx.arc(dustX, dustY, 3 * (1 - dustProgress), 0, Math.PI * 2);
                ctx.fill();
              }
              
              ctx.restore();
              
            } else if (anim.type === 'castle_lightning') {
              // Wizard lightning bolt
              ctx.save();
              
              // Lightning bolt with jagged path
              const segments = 8;
              const segmentLength = Math.sqrt(Math.pow(anim.toX - anim.fromX, 2) + Math.pow(anim.toY - anim.fromY, 2)) / segments;
              const baseAngle = Math.atan2(anim.toY - anim.fromY, anim.toX - anim.fromX);
              
              ctx.strokeStyle = '#00FFFF';
              ctx.lineWidth = 4;
              ctx.shadowColor = '#00FFFF';
              ctx.shadowBlur = 15;
              ctx.lineCap = 'round';
              
              ctx.beginPath();
              ctx.moveTo(anim.fromX, anim.fromY);
              
              let currentLightningX = anim.fromX;
              let currentLightningY = anim.fromY;
              
              for (let i = 1; i <= segments && i <= segments * progress; i++) {
                const jitter = (Math.random() - 0.5) * 20;
                const nextX = anim.fromX + Math.cos(baseAngle) * segmentLength * i + Math.cos(baseAngle + Math.PI/2) * jitter;
                const nextY = anim.fromY + Math.sin(baseAngle) * segmentLength * i + Math.sin(baseAngle + Math.PI/2) * jitter;
                
                ctx.lineTo(nextX, nextY);
                currentLightningX = nextX;
                currentLightningY = nextY;
              }
              
              ctx.stroke();
              
              // Lightning glow effect
              ctx.strokeStyle = '#FFFFFF';
              ctx.lineWidth = 2;
              ctx.shadowBlur = 25;
              ctx.stroke();
              
              // Sparks at current position
              for (let i = 0; i < 6; i++) {
                const sparkAngle = (Math.PI * 2 * i) / 6;
                const sparkDistance = 8 + Math.random() * 6;
                const sparkX = currentLightningX + Math.cos(sparkAngle) * sparkDistance;
                const sparkY = currentLightningY + Math.sin(sparkAngle) * sparkDistance;
                
                ctx.fillStyle = '#00FFFF';
                ctx.shadowColor = '#00FFFF';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(sparkX, sparkY, 2, 0, Math.PI * 2);
                ctx.fill();
              }
              
              ctx.restore();
                } else if (anim.type === 'castle_multi_arrow') {
              // Multi-arrow attack (arrows spread)
              ctx.save();
              
              const arrowCount = 5;
              const spreadAngle = Math.PI / 8; // 22.5 degrees spread
              const baseAngle = Math.atan2(anim.toY - anim.fromY, anim.toX - anim.fromX);
              
              for (let i = 0; i < arrowCount; i++) {
                const arrowAngle = baseAngle + (i - 2) * (spreadAngle / 2);
                
                // Arrow shaft
                ctx.strokeStyle = '#228B22';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(anim.fromX, anim.fromY);
                ctx.lineTo(currentX, currentY);
                ctx.stroke();
                
                // Arrow head
                ctx.fillStyle = '#FFD700';
                ctx.save();
                ctx.translate(currentX, currentY);
                ctx.rotate(arrowAngle);
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(-8, -3);
                ctx.lineTo(-8, 3);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
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
            
            // Show level indicator
            ctx.fillStyle = 'white';
            ctx.font = '8px Arial';
            ctx.fillText(`L${trap.level || 1}`, trap.x, trap.y - 18);
            
            // Selection highlight
            if (selectedTrap === trap.id) {
              ctx.strokeStyle = '#FFD700';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.arc(trap.x, trap.y, 20, 0, Math.PI * 2);
              ctx.stroke();
            }
            
            ctx.restore();
          }
        });
      }

      // Draw turrets
      if (gameState.turrets) {
        gameState.turrets.forEach(turret => {
          const player = gameState.players.find(p => p.id === turret.playerId);
          if (!player) return;

          ctx.save();

          // Skin by level
          let bodyColor = player.color;
          let cannonColor = '#666';
          let outlineColor = '#000';
          let turretSize = 30;
          let cannonWidth = 6;
          let cannonLength = 25;
          let deco = false;
          let decoColor = '#FFD700';

          if (turret.level === 2) {
            bodyColor = '#90caf9'; // blue
            cannonColor = '#1976d2';
            outlineColor = '#1976d2';
            turretSize = 34;
            cannonWidth = 7;
            cannonLength = 28;
          } else if (turret.level === 3) {
            bodyColor = '#a5d6a7'; // green
            cannonColor = '#388e3c';
            outlineColor = '#388e3c';
            turretSize = 38;
            cannonWidth = 8;
            cannonLength = 32;
            deco = true;
            decoColor = '#FFD700';
          } else if (turret.level === 4) {
            bodyColor = '#ffe082'; // yellow
            cannonColor = '#fbc02d';
            outlineColor = '#fbc02d';
            turretSize = 42;
            cannonWidth = 9;
            cannonLength = 36;
            deco = true;
            decoColor = '#FF8C00';
          } else if (turret.level >= 5) {
            bodyColor = '#ff8a65'; // orange
            cannonColor = '#d84315';
            outlineColor = '#d84315';
            turretSize = 48;
            cannonWidth = 10;
            cannonLength = 40;
            deco = true;
            decoColor = '#FFD700';
          }

          // Draw turret body
          ctx.fillStyle = bodyColor;
          ctx.strokeStyle = outlineColor;
          ctx.lineWidth = 2 + turret.level;
          ctx.fillRect(turret.x - turretSize/2, turret.y - turretSize/2, turretSize, turretSize);
          ctx.strokeRect(turret.x - turretSize/2, turret.y - turretSize/2, turretSize, turretSize);

          // Draw cannon
          ctx.fillStyle = cannonColor;
          ctx.fillRect(turret.x - cannonWidth/2, turret.y - turretSize/2 - cannonLength + 10, cannonWidth, cannonLength);

          // Draw decorations for higher levels
          if (deco) {
            ctx.save();
            ctx.strokeStyle = decoColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(turret.x, turret.y, turretSize/2 + 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

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
          const barWidth = turretSize;
          const barHeight = 4;
          const barY = turret.y - turretSize/2 - 10;

          ctx.fillStyle = '#333';
          ctx.fillRect(turret.x - barWidth/2, barY, barWidth, barHeight);

          ctx.fillStyle = healthPercent > 0.5 ? '#4CAF50' : healthPercent > 0.25 ? '#FFC107' : '#F44336';
          ctx.fillRect(turret.x - barWidth/2, barY, barWidth * healthPercent, barHeight);

          ctx.fillStyle = 'white';
          ctx.font = '10px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(`L${turret.level}`, turret.x, turret.y + 4);

          if (selectedTurret === turret.id) {
            ctx.strokeStyle = '#FFD700';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(turret.x, turret.y, turretSize/2 + 10, 0, Math.PI * 2);
            ctx.stroke();
          }

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
            
            // Show level indicator
            ctx.fillStyle = 'white';
            ctx.font = '8px Arial';
            ctx.fillText(`L${mine.level || 1}`, mine.x, mine.y - 16);
            
            // Selection highlight
            if (selectedMine === mine.id) {
              ctx.strokeStyle = '#FFD700';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.arc(mine.x, mine.y, 18, 0, Math.PI * 2);
              ctx.stroke();
            }
            
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

    } catch (err) {
      console.error('Canvas rendering error:', err);
    }
  }, [gameState]);

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
        Wizard: 400
      };
      if (myResources >= (unitCosts[unitType] || 0)) {
        socket.emit('spawn-unit', { 
          gameId, 
          unitType, 
          lane: getMySelectedLane()
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
      socket.emit('place-turret', { gameId, x, y });
    }
  };
  const upgradeTurret = (turretId: string) => {
    if (socket && gameId) {
      socket.emit('upgrade-turret', { gameId, turretId });
    }
  };

  const upgradeTrap = (trapId: string) => {
    if (socket && gameId) {
      socket.emit('upgrade-trap', { gameId, trapId });
    }
  };

  const upgradeMine = (mineId: string) => {
    if (socket && gameId) {
      socket.emit('upgrade-mine', { gameId, mineId });
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
  const purchasePowerup = (unitType: string, powerupName: string, cost: number) => {
    if (socket && gameId && gameState && playerIndex >= 0) {
      const myResources = gameState.playerResources[gameState.players[playerIndex].id] || 0;
      
      if (myResources >= cost) {
        socket.emit('purchase-powerup', { gameId, unitType, powerupName });
      }
    }
  };

  const isPowerupPurchased = (unitType: string, powerupName: string): boolean => {
    if (!gameState || playerIndex < 0) return false;
    const playerId = gameState.players[playerIndex].id;
    const playerPowerups = gameState.playerPowerups?.[playerId];
    return playerPowerups && playerPowerups[unitType] && playerPowerups[unitType][powerupName] || false;
  };
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !gameState || playerIndex < 0) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Check if clicking on player's own castle
    const myCastle = gameState.playerBases[gameState.players[playerIndex].id];
    if (myCastle) {
      const distanceToCastle = Math.sqrt(Math.pow(myCastle.x - x, 2) + Math.pow(myCastle.y - y, 2));
      if (distanceToCastle <= 40) { // Castle click radius
        setSelectedCastle(true);
        setSelectedTurret(null);
        return;
      }
    }
    
    // Check if clicking on a turret for upgrade
    const clickedTurret = gameState.turrets.find(turret => {
      if (turret.playerId !== gameState.players[playerIndex].id) return false;
      const distance = Math.sqrt(Math.pow(turret.x - x, 2) + Math.pow(turret.y - y, 2));
      return distance <= 25; // Turret radius
    });
      if (clickedTurret) {
      setSelectedTurret(clickedTurret.id);
      setSelectedCastle(false);
      setSelectedTrap(null);
      setSelectedMine(null);
      return;
    }

    // Check if clicking on a trap for upgrade
    const clickedTrap = gameState.traps.find(trap => {
      if (trap.playerId !== gameState.players[playerIndex].id) return false;
      const distance = Math.sqrt(Math.pow(trap.x - x, 2) + Math.pow(trap.y - y, 2));
      return distance <= 15; // Trap radius
    });
    
    if (clickedTrap) {
      setSelectedTrap(clickedTrap.id);
      setSelectedTurret(null);
      setSelectedCastle(false);
      setSelectedMine(null);
      return;
    }

    // Check if clicking on a mine for upgrade
    const clickedMine = gameState.mines.find(mine => {
      if (mine.playerId !== gameState.players[playerIndex].id) return false;
      const distance = Math.sqrt(Math.pow(mine.x - x, 2) + Math.pow(mine.y - y, 2));
      return distance <= 12; // Mine radius
    });
    
    if (clickedMine) {
      setSelectedMine(clickedMine.id);
      setSelectedTurret(null);
      setSelectedCastle(false);
      setSelectedTrap(null);
      return;
    }
    
    // Check if click is on player's own half
    const CANVAS_WIDTH = 1200;
    const playerHalfStart = playerIndex === 0 ? 0 : CANVAS_WIDTH / 2;
    const playerHalfEnd = playerIndex === 0 ? CANVAS_WIDTH / 2 : CANVAS_WIDTH;
    
    if (x >= playerHalfStart && x <= playerHalfEnd) {
      // Place structure based on current placement mode
      if (placementMode === 'trap') {
        placeTrap(x, y);
      } else if (placementMode === 'turret') {
        placeTurret(x, y);
      } else if (placementMode === 'mine') {
        placeMine(x, y);      }
    }
    
    setSelectedTurret(null);
    setSelectedCastle(false);
    setSelectedTrap(null);
    setSelectedMine(null);
  };

  // Get current lane selection for display
  const mySelectedLane = getMySelectedLane();
  return (
    <div className="app">
      <h1>The game of game</h1>
      
      {/* Toast Notification */}
      {showToast && (
        <div 
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 1000,
            padding: '1rem 1.5rem',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            backgroundColor: toastType === 'success' ? '#28a745' : toastType === 'error' ? '#dc3545' : '#17a2b8',
            color: 'white',
            fontSize: '16px',
            fontWeight: '600',
            maxWidth: '400px',
            animation: 'slideInRight 0.3s ease-out'
          }}
        >
          {toastMessage}
        </div>
      )}
      
      {error && (
        <div style={{color: 'red', padding: '1rem', background: '#ffe6e6', border: '1px solid red', borderRadius: '0.5rem', margin: '1rem 0'}}>
          Error: {error}
        </div>
      )}
      
      <div className="connection-status">
        Status: {connectionStatus}
      </div>

      {!gameState ? (
        <div>
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
        <div className="game">          <div className="game-header">
            <div className="player-info">
              <strong>Resources: {getMyResources()}</strong>
              <div>Production: {getProduction().toFixed(1)}/sec</div>
              <div>Base Health: {getMyBaseHealth().health}/{getMyBaseHealth().maxHealth}</div>
            </div>
          </div>

          <div className="game-controls">            <div className="tab-buttons">
              <button 
                className={activeTab === 'units' ? 'active' : ''} 
                onClick={() => setActiveTab('units')}
              >
                Units
              </button>
              <button 
                className={activeTab === 'defense' ? 'active' : ''} 
                onClick={() => setActiveTab('defense')}
              >
                Defense
              </button>
              <button 
                className={activeTab === 'castle' ? 'active' : ''} 
                onClick={() => setActiveTab('castle')}
              >
                Castle
              </button>
              <button 
                className={activeTab === 'powerups' ? 'active' : ''} 
                onClick={() => setActiveTab('powerups')}
              >
                Powerups
              </button>
              <button 
                className={activeTab === 'info' ? 'active' : ''} 
                onClick={() => setActiveTab('info')}
              >
                Info
              </button>
            </div>

            {activeTab === 'defense' && (
                <div className="defense-controls">
                <div className="placement-modes d-flex flex-row justify-content-center gap-3 my-3">                  <button
                  className={`btn btn-lg ${placementMode === 'turret' ? 'btn-primary' : 'btn-outline-primary'}`}
                  style={{ minWidth: 180, fontSize: 22, fontWeight: 600 }}
                  onClick={() => setPlacementMode('turret')}
                  >
                  🏰 Place Turret <span className="badge text-white ms-2" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>50</span>
                  </button>
                  <button
                  className={`btn btn-lg ${placementMode === 'trap' ? 'btn-warning' : 'btn-outline-warning'}`}
                  style={{ minWidth: 180, fontSize: 22, fontWeight: 600 }}
                  onClick={() => setPlacementMode('trap')}
                  >
                  ⚠️ Place Trap <span className="badge text-white ms-2" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>50</span>
                  </button>
                  <button
                  className={`btn btn-lg ${placementMode === 'mine' ? 'btn-danger' : 'btn-outline-danger'}`}
                  style={{ minWidth: 180, fontSize: 22, fontWeight: 600 }}
                  onClick={() => setPlacementMode('mine')}
                  >
                  💣 Place Mine <span className="badge text-white ms-2" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>75</span>
                  </button>
                </div>                {selectedTurret && (
                  <div className="turret-upgrade text-center mt-4">
                  <h3 className="mb-3">Selected Turret</h3>
                  <div className="turret-actions d-flex flex-row justify-content-center gap-3">
                    <button
                    className="btn btn-success btn-lg px-4 py-2"
                    style={{ fontSize: 22 }}
                    onClick={() => upgradeTurret(selectedTurret)}
                    >
                    <i className="bi bi-arrow-up-circle fs-3 me-2"></i> Upgrade
                    </button>
                    <button
                    className="btn btn-secondary btn-lg px-4 py-2"
                    style={{ fontSize: 22 }}
                    onClick={() => setSelectedTurret(null)}
                    >
                    <i className="bi bi-x-circle fs-3 me-2"></i> Deselect
                    </button>
                  </div>
                  </div>
                )}

                {selectedTrap && (
                  <div className="trap-upgrade text-center mt-4">
                  <h3 className="mb-3">Selected Trap</h3>
                  <div className="trap-actions d-flex flex-row justify-content-center gap-3">
                    <button
                    className="btn btn-warning btn-lg px-4 py-2"
                    style={{ fontSize: 22 }}
                    onClick={() => upgradeTrap(selectedTrap)}
                    >
                    <i className="bi bi-arrow-up-circle fs-3 me-2"></i> Upgrade
                    </button>
                    <button
                    className="btn btn-secondary btn-lg px-4 py-2"
                    style={{ fontSize: 22 }}
                    onClick={() => setSelectedTrap(null)}
                    >
                    <i className="bi bi-x-circle fs-3 me-2"></i> Deselect
                    </button>
                  </div>
                  </div>
                )}

                {selectedMine && (
                  <div className="mine-upgrade text-center mt-4">
                  <h3 className="mb-3">Selected Mine</h3>
                  <div className="mine-actions d-flex flex-row justify-content-center gap-3">
                    <button
                    className="btn btn-danger btn-lg px-4 py-2"
                    style={{ fontSize: 22 }}
                    onClick={() => upgradeMine(selectedMine)}
                    >
                    <i className="bi bi-arrow-up-circle fs-3 me-2"></i> Upgrade
                    </button>
                    <button
                    className="btn btn-secondary btn-lg px-4 py-2"
                    style={{ fontSize: 22 }}
                    onClick={() => setSelectedMine(null)}
                    >
                    <i className="bi bi-x-circle fs-3 me-2"></i> Deselect
                    </button>
                  </div>
                  </div>
                )}
                </div>
            )}

            {activeTab === 'units' && (
              <div className="units-tab">
                <div className="unit-list">
                  <div className="unit-item">
                    <span className="unit-name">⚒️ Peasant</span>
                    <span className="unit-cost">25</span>
                    <button 
                      className="deploy-btn" 
                      onClick={() => spawnUnit('Peasant')}
                      disabled={getMyResources() < 25}
                    >
                      Deploy
                    </button>
                  </div>
                  
                  <div className="unit-item">
                    <span className="unit-name">⚔️ Knight</span>
                    <span className="unit-cost">150</span>
                    <button 
                      className="deploy-btn" 
                      onClick={() => spawnUnit('Knight')}
                      disabled={getMyResources() < 150}
                    >
                      Deploy
                    </button>
                  </div>
                  
                  <div className="unit-item">
                    <span className="unit-name">🏹 Archer</span>
                    <span className="unit-cost">350</span>
                    <button 
                      className="deploy-btn" 
                      onClick={() => spawnUnit('Archer')}
                      disabled={getMyResources() < 350}
                    >
                      Deploy
                    </button>
                  </div>
                  
                  <div className="unit-item">
                    <span className="unit-name">👑 King</span>
                    <span className="unit-cost">500</span>
                    <button 
                      className="deploy-btn" 
                      onClick={() => spawnUnit('King')}
                      disabled={getMyResources() < 500}
                    >
                      Deploy
                    </button>
                  </div>
                  
                  <div className="unit-item">
                    <span className="unit-name">🔮 Wizard</span>
                    <span className="unit-cost">400</span>
                    <button 
                      className="deploy-btn" 
                      onClick={() => spawnUnit('Wizard')}
                      disabled={getMyResources() < 400}
                    >
                      Deploy
                    </button>
                  </div>
                </div>
                
                <div className="lane-selector">
                  <div className="lane-label">Lane:</div>
                  <div className="lane-buttons">
                    {LANES.map((lane) => (
                      <button
                        key={lane}
                        className={`lane-btn${mySelectedLane === lane ? ' selected' : ''}`}
                        onClick={() => selectLane(lane)}
                      >
                        {lane + 1}
                      </button>
                    ))}
                  </div>
                </div>
              </div>            )}            {activeTab === 'castle' && (
              <div className="castle-tab">
                <div className="castle-info text-center mb-4">
                  <h3>Castle Level {getMyBaseHealth().level}</h3>
                  <div className="d-flex justify-content-center gap-4 mb-3">
                    <div><strong>Health:</strong> {getMyBaseHealth().health}/{getMyBaseHealth().maxHealth}</div>
                    <div><strong>Weapon:</strong> {getMyBaseHealth().weaponType}</div>
                    <div><strong>Damage:</strong> {getMyBaseHealth().damage || 10}</div>
                    <div><strong>Range:</strong> {getMyBaseHealth().attackRange || 120}</div>
                  </div>
                </div>

                <div className="castle-controls">
                  <div className="castle-upgrade text-center mb-4">
                    <button
                      className="btn btn-primary btn-lg px-4 py-2"
                      style={{ fontSize: 20, fontWeight: 600 }}
                      onClick={upgradeCastle}
                      disabled={getMyBaseHealth().level >= 5 || getMyResources() < (getMyBaseHealth().level || 1) * 200}
                    >
                      <i className="bi bi-house-up fs-3 me-2"></i>
                      {getMyBaseHealth().level >= 5 ? 'Max Level Reached' : `Upgrade Castle (Cost: ${(getMyBaseHealth().level || 1) * 200})`}
                    </button>
                    {getMyBaseHealth().level < 5 && (
                      <div className="mt-2 text-muted">
                        Level {(getMyBaseHealth().level || 1) + 1} unlocks: 
                        {(getMyBaseHealth().level || 1) === 1 && ' Multi-Arrow weapon'}
                        {(getMyBaseHealth().level || 1) === 2 && ' Trebuchet weapon'}
                        {(getMyBaseHealth().level || 1) === 3 && ' Magic Tower weapon'}
                        {(getMyBaseHealth().level || 1) >= 4 && ' Enhanced stats'}
                      </div>
                    )}
                  </div>

                  <div className="weapon-selection">
                    <h4 className="text-center mb-3">Available Weapons</h4>
                    <div className="d-flex flex-wrap justify-content-center gap-3">                      <button
                        className={`btn btn-lg ${getMyBaseHealth().weaponType === 'basic' ? 'btn-success' : 'btn-outline-success'}`}
                        style={{ minWidth: 150, fontSize: 18 }}
                        onClick={() => changeCastleWeapon('basic')}
                      >
                        🏹 Basic Arrows
                        <br />
                        <small style={{ color: 'white' }}>Free</small>
                      </button>
                        <button
                        className={`btn btn-lg ${getMyBaseHealth().weaponType === 'arrows' ? 'btn-success' : 'btn-outline-success'}`}
                        style={{ minWidth: 150, fontSize: 18 }}
                        onClick={() => changeCastleWeapon('arrows')}
                        disabled={!getMyBaseHealth().unlockedWeapons?.includes('arrows')}
                      >
                        🎯 Multi-Arrow
                        <br />
                        <small style={{ color: getMyBaseHealth().unlockedWeapons?.includes('arrows') ? 'white' : undefined }}>
                          {getMyBaseHealth().unlockedWeapons?.includes('arrows') ? 'Cost: 50' : 'Unlock at Level 2'}
                        </small>
                      </button>
                      
                      <button
                        className={`btn btn-lg ${getMyBaseHealth().weaponType === 'trebuchet' ? 'btn-success' : 'btn-outline-success'}`}
                        style={{ minWidth: 150, fontSize: 18 }}
                        onClick={() => changeCastleWeapon('trebuchet')}
                        disabled={!getMyBaseHealth().unlockedWeapons?.includes('trebuchet')}
                      >
                        🏰 Trebuchet
                        <br />
                        <small style={{ color: getMyBaseHealth().unlockedWeapons?.includes('trebuchet') ? 'white' : undefined }}>
                          {getMyBaseHealth().unlockedWeapons?.includes('trebuchet') ? 'Cost: 100' : 'Unlock at Level 3'}
                        </small>
                      </button>
                      
                      <button
                        className={`btn btn-lg ${getMyBaseHealth().weaponType === 'wizard' ? 'btn-success' : 'btn-outline-success'}`}
                        style={{ minWidth: 150, fontSize: 18 }}
                        onClick={() => changeCastleWeapon('wizard')}
                        disabled={!getMyBaseHealth().unlockedWeapons?.includes('wizard')}
                      >
                        🔮 Magic Tower
                        <br />
                        <small style={{ color: getMyBaseHealth().unlockedWeapons?.includes('wizard') ? 'white' : undefined }}>
                          {getMyBaseHealth().unlockedWeapons?.includes('wizard') ? 'Cost: 150' : 'Unlock at Level 4'}
                        </small>
                      </button>
                    </div>
                  </div>

                  {selectedCastle && (
                    <div className="castle-selected text-center mt-4">
                      <div className="alert alert-info">
                        <strong>Castle Selected!</strong> Use the controls above to upgrade or change weapons.
                      </div>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setSelectedCastle(false)}
                      >
                        Deselect Castle
                      </button>
                    </div>
                  )}                </div>
              </div>
            )}

            {activeTab === 'powerups' && (
              <div className="powerups-tab">
                <h3 className="text-center mb-4" style={{ color: '#9b59b6' }}>Unit Powerups</h3>
                <div className="powerups-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                  
                  {/* Peasant Powerups */}
                  <div className="powerup-category" style={{ background: 'linear-gradient(135deg, #2c3e50, #34495e)', border: '2px solid #95a5a6', borderRadius: '0.75rem', padding: '1.5rem' }}>
                    <h4 style={{ color: '#95a5a6', textAlign: 'center', marginBottom: '1rem' }}>⚒️ Peasant Upgrades</h4>                    <div className="powerup-card" style={{ padding: '1rem', background: 'rgba(149, 165, 166, 0.1)', borderRadius: '0.5rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#ecf0f1' }}>Enhanced Tools</strong>
                        <span style={{ color: '#f39c12', fontWeight: '600' }}>Cost: 150</span>
                      </div>                      <p style={{ color: '#bdc3c7', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>+50% damage, +25% speed for all Peasant units</p>                      <button 
                        className={`btn btn-sm ${isPowerupPurchased('peasant', 'enhancedTools') ? 'btn-secondary' : 'btn-outline-light'}`}
                        style={{ width: '100%' }}
                        onClick={() => purchasePowerup('peasant', 'enhancedTools', 150)}
                        disabled={isPowerupPurchased('peasant', 'enhancedTools') || getMyResources() < 150}
                      >
                        {isPowerupPurchased('peasant', 'enhancedTools') ? 'Applied' : 'Upgrade'}
                      </button>
                    </div>                    <div className="powerup-card" style={{ padding: '1rem', background: 'rgba(149, 165, 166, 0.1)', borderRadius: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#ecf0f1' }}>Hardy Workers</strong>
                        <span style={{ color: '#f39c12', fontWeight: '600' }}>Cost: 200</span>
                      </div>                      <p style={{ color: '#bdc3c7', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>+100% health, +10% resource generation per Peasant</p>                      <button 
                        className={`btn btn-sm ${isPowerupPurchased('peasant', 'hardyWorkers') ? 'btn-secondary' : 'btn-outline-light'}`}
                        style={{ width: '100%' }}
                        onClick={() => purchasePowerup('peasant', 'hardyWorkers', 200)}
                        disabled={isPowerupPurchased('peasant', 'hardyWorkers') || getMyResources() < 200}
                      >
                        {isPowerupPurchased('peasant', 'hardyWorkers') ? 'Applied' : 'Upgrade'}
                      </button>
                    </div>
                  </div>

                  {/* Knight Powerups */}
                  <div className="powerup-category" style={{ background: 'linear-gradient(135deg, #2c3e50, #34495e)', border: '2px solid #C0C0C0', borderRadius: '0.75rem', padding: '1.5rem' }}>
                    <h4 style={{ color: '#C0C0C0', textAlign: 'center', marginBottom: '1rem' }}>⚔️ Knight Upgrades</h4>                    <div className="powerup-card" style={{ padding: '1rem', background: 'rgba(192, 192, 192, 0.1)', borderRadius: '0.5rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#ecf0f1' }}>Master Armor</strong>
                        <span style={{ color: '#f39c12', fontWeight: '600' }}>Cost: 300</span>
                      </div>                      <p style={{ color: '#bdc3c7', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>Armor blocks 35% damage instead of 20%</p>                      <button 
                        className={`btn btn-sm ${isPowerupPurchased('knight', 'masterArmor') ? 'btn-secondary' : 'btn-outline-light'}`}
                        style={{ width: '100%' }}
                        onClick={() => purchasePowerup('knight', 'masterArmor', 300)}
                        disabled={isPowerupPurchased('knight', 'masterArmor') || getMyResources() < 300}
                      >
                        {isPowerupPurchased('knight', 'masterArmor') ? 'Applied' : 'Upgrade'}
                      </button>
                    </div>
                    <div className="powerup-card" style={{ padding: '1rem', background: 'rgba(192, 192, 192, 0.1)', borderRadius: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#ecf0f1' }}>Battle Charge</strong>
                        <span style={{ color: '#f39c12', fontWeight: '600' }}>Cost: 400</span>
                      </div>                      <p style={{ color: '#bdc3c7', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>+50% speed, +25% damage when health below 50%</p>                      <button 
                        className={`btn btn-sm ${isPowerupPurchased('knight', 'battleCharge') ? 'btn-secondary' : 'btn-outline-light'}`}
                        style={{ width: '100%' }}
                        onClick={() => purchasePowerup('knight', 'battleCharge', 400)}
                        disabled={isPowerupPurchased('knight', 'battleCharge') || getMyResources() < 400}
                      >
                        {isPowerupPurchased('knight', 'battleCharge') ? 'Applied' : 'Upgrade'}
                      </button>
                    </div>
                  </div>

                  {/* Archer Powerups */}
                  <div className="powerup-category" style={{ background: 'linear-gradient(135deg, #2c3e50, #34495e)', border: '2px solid #228B22', borderRadius: '0.75rem', padding: '1.5rem' }}>
                    <h4 style={{ color: '#228B22', textAlign: 'center', marginBottom: '1rem' }}>🏹 Archer Upgrades</h4>                    <div className="powerup-card" style={{ padding: '1rem', background: 'rgba(34, 139, 34, 0.1)', borderRadius: '0.5rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#ecf0f1' }}>Eagle Eye</strong>
                        <span style={{ color: '#f39c12', fontWeight: '600' }}>Cost: 350</span>
                      </div>                      <p style={{ color: '#bdc3c7', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>Critical hit chance increased to 25%</p>                      <button 
                        className={`btn btn-sm ${isPowerupPurchased('archer', 'eagleEye') ? 'btn-secondary' : 'btn-outline-light'}`}
                        style={{ width: '100%' }}
                        onClick={() => purchasePowerup('archer', 'eagleEye', 350)}
                        disabled={isPowerupPurchased('archer', 'eagleEye') || getMyResources() < 350}
                      >
                        {isPowerupPurchased('archer', 'eagleEye') ? 'Applied' : 'Upgrade'}
                      </button>
                    </div>                    <div className="powerup-card" style={{ padding: '1rem', background: 'rgba(34, 139, 34, 0.1)', borderRadius: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#ecf0f1' }}>Piercing Shots</strong>
                        <span style={{ color: '#f39c12', fontWeight: '600' }}>Cost: 450</span>
                      </div>                      <p style={{ color: '#bdc3c7', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>Arrows pierce through enemies, hitting up to 2 targets</p>                      <button 
                        className={`btn btn-sm ${isPowerupPurchased('archer', 'piercingShots') ? 'btn-secondary' : 'btn-outline-light'}`}
                        style={{ width: '100%' }}
                        onClick={() => purchasePowerup('archer', 'piercingShots', 450)}
                        disabled={isPowerupPurchased('archer', 'piercingShots') || getMyResources() < 450}
                      >
                        {isPowerupPurchased('archer', 'piercingShots') ? 'Applied' : 'Upgrade'}
                      </button>
                    </div>
                  </div>

                  {/* King Powerups */}
                  <div className="powerup-category" style={{ background: 'linear-gradient(135deg, #2c3e50, #34495e)', border: '2px solid #FFD700', borderRadius: '0.75rem', padding: '1.5rem' }}>
                    <h4 style={{ color: '#FFD700', textAlign: 'center', marginBottom: '1rem' }}>👑 King Upgrades</h4>                    <div className="powerup-card" style={{ padding: '1rem', background: 'rgba(255, 215, 0, 0.1)', borderRadius: '0.5rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#ecf0f1' }}>Royal Authority</strong>
                        <span style={{ color: '#f39c12', fontWeight: '600' }}>Cost: 500</span>
                      </div>                      <p style={{ color: '#bdc3c7', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>Aura range +50%, damage bonus increased to 50%</p>                      <button 
                        className={`btn btn-sm ${isPowerupPurchased('king', 'royalAuthority') ? 'btn-secondary' : 'btn-outline-light'}`}
                        style={{ width: '100%' }}
                        onClick={() => purchasePowerup('king', 'royalAuthority', 500)}
                        disabled={isPowerupPurchased('king', 'royalAuthority') || getMyResources() < 500}
                      >
                        {isPowerupPurchased('king', 'royalAuthority') ? 'Applied' : 'Upgrade'}
                      </button>
                    </div>
                    <div className="powerup-card" style={{ padding: '1rem', background: 'rgba(255, 215, 0, 0.1)', borderRadius: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#ecf0f1' }}>Divine Protection</strong>
                        <span style={{ color: '#f39c12', fontWeight: '600' }}>Cost: 600</span>
                      </div>                      <p style={{ color: '#bdc3c7', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>King becomes immune to critical hits and regenerates health</p>                      <button 
                        className={`btn btn-sm ${isPowerupPurchased('king', 'divineProtection') ? 'btn-secondary' : 'btn-outline-light'}`}
                        style={{ width: '100%' }}
                        onClick={() => purchasePowerup('king', 'divineProtection', 600)}
                        disabled={isPowerupPurchased('king', 'divineProtection') || getMyResources() < 600}
                      >
                        {isPowerupPurchased('king', 'divineProtection') ? 'Applied' : 'Upgrade'}
                      </button>
                    </div>
                  </div>

                  {/* Wizard Powerups */}
                  <div className="powerup-category" style={{ background: 'linear-gradient(135deg, #2c3e50, #34495e)', border: '2px solid #8A2BE2', borderRadius: '0.75rem', padding: '1.5rem' }}>
                    <h4 style={{ color: '#8A2BE2', textAlign: 'center', marginBottom: '1rem' }}>🔮 Wizard Upgrades</h4>                    <div className="powerup-card" style={{ padding: '1rem', background: 'rgba(138, 43, 226, 0.1)', borderRadius: '0.5rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#ecf0f1' }}>Arc Lightning</strong>
                        <span style={{ color: '#f39c12', fontWeight: '600' }}>Cost: 400</span>
                      </div>                      <p style={{ color: '#bdc3c7', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>Chain lightning hits +2 targets with increased range</p>                      <button 
                        className={`btn btn-sm ${isPowerupPurchased('wizard', 'arcLightning') ? 'btn-secondary' : 'btn-outline-light'}`}
                        style={{ width: '100%' }}
                        onClick={() => purchasePowerup('wizard', 'arcLightning', 400)}
                        disabled={isPowerupPurchased('wizard', 'arcLightning') || getMyResources() < 400}
                      >
                        {isPowerupPurchased('wizard', 'arcLightning') ? 'Applied' : 'Upgrade'}
                      </button>
                    </div>
                    <div className="powerup-card" style={{ padding: '1rem', background: 'rgba(138, 43, 226, 0.1)', borderRadius: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <strong style={{ color: '#ecf0f1' }}>Mana Shield</strong>
                        <span style={{ color: '#f39c12', fontWeight: '600' }}>Cost: 550</span>
                      </div>                      <p style={{ color: '#bdc3c7', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>Wizard takes 40% less damage and reflects 25% back to attackers</p>                      <button 
                        className={`btn btn-sm ${isPowerupPurchased('wizard', 'manaShield') ? 'btn-secondary' : 'btn-outline-light'}`}
                        style={{ width: '100%' }}
                        onClick={() => purchasePowerup('wizard', 'manaShield', 550)}
                        disabled={isPowerupPurchased('wizard', 'manaShield') || getMyResources() < 550}
                      >
                        {isPowerupPurchased('wizard', 'manaShield') ? 'Applied' : 'Upgrade'}
                      </button>
                    </div>
                  </div>

                </div>
                
                <div className="powerups-info text-center mt-4" style={{ padding: '1rem', background: 'rgba(155, 89, 182, 0.1)', border: '2px solid #9b59b6', borderRadius: '0.75rem' }}>
                  <p style={{ color: '#9b59b6', margin: 0, fontWeight: '600' }}>
                    Powerups provide permanent upgrades to all units of the selected type. Choose wisely to enhance your army!
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'info' && (
              <div className="info-tab">
                <div className="info-section">
                  <h4>Castle System</h4>
                  <div className="ability-list">
                    <div><strong>Level 1:</strong> Basic arrows, 100 HP</div>
                    <div><strong>Level 2:</strong> Unlocks Multi-Arrow, 140 HP</div>
                    <div><strong>Level 3:</strong> Unlocks Trebuchet, 196 HP</div>
                    <div><strong>Level 4:</strong> Unlocks Magic Tower, 274 HP</div>
                    <div><strong>Level 5:</strong> Maximum stats, 384 HP</div>
                    <div className="mt-2"><small>Upgrade costs: 200, 400, 800, 1600</small></div>
                  </div>
                </div>

                <div className="info-section">
                  <h4>Castle Weapons</h4>
                  <div className="ability-list">
                    <div>🏹 <strong>Basic:</strong> Standard arrows - Free</div>
                    <div>🎯 <strong>Multi-Arrow:</strong> Fires 5 arrows simultaneously - Cost: 50</div>
                    <div>🏰 <strong>Trebuchet:</strong> Heavy boulders with splash damage - Cost: 100</div>
                    <div>🔮 <strong>Magic Tower:</strong> Lightning with chain effect - Cost: 150</div>
                  </div>
                </div>
                
                <div className="info-section">
                  <h4>Unit Abilities</h4>
                  <div className="ability-list">
                    <div>🛡️ <strong>Knight:</strong> High armor and durability</div>
                    <div>🎯 <strong>Archer:</strong> Long range attacks</div>
                    <div>👑 <strong>King:</strong> Powerful aura boosts nearby units</div>
                    <div>⚡ <strong>Wizard:</strong> Chain lightning attacks</div>
                    <div>⚒️ <strong>Peasant:</strong> Basic worker unit</div>
                  </div>
                </div>
                
                <div className="info-section">
                  <h4>Current Stats</h4>
                  <div>Resources: {getMyResources()}</div>
                  <div>Production: {getProduction().toFixed(1)}/sec</div>
                  <div>Units: {gameState.units.filter(u => u.playerId === gameState.players[playerIndex]?.id).length}</div>
                  <div>Castle Level: {getMyBaseHealth().level || 1}</div>
                  <div>Castle Weapon: {getMyBaseHealth().weaponType}</div>
                  <div>Available Weapons: {getMyBaseHealth().unlockedWeapons?.length || 1}</div>
                </div>
              </div>
            )}
          </div>

          <canvas
            ref={canvasRef}
            width={1200}
            height={600}
            onClick={handleCanvasClick}
            style={{
              border: '2px solid #333',
              backgroundColor: '#2d4a22',
              cursor: placementMode ? 'crosshair' : 'default'
            }}
          />
        </div>
      )}
    </div>
  );
}

export default App;
