import React, { useRef, useEffect, useState, useCallback } from 'react';
import './PlinkoBoard.css';

interface Ball {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

interface Peg {
  x: number;
  y: number;
  radius: number;
}

interface Slot {
  x: number;
  width: number;
  multiplier: number;
  color: string;
  collected: number;
}

interface PlinkoBoardProps {
  onReward?: (multiplier: number, amount: number) => void;
  playerResources: number;
}

const PlinkoBoard: React.FC<PlinkoBoardProps> = ({ onReward, playerResources }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const [balls, setBalls] = useState<Ball[]>([]);
  const [pegs, setPegs] = useState<Peg[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [dropPoints, setDropPoints] = useState<number[]>([]);
  const [isDropping, setIsDropping] = useState(false);
  const [dropCost, setDropCost] = useState(5);
  const [inputCost, setInputCost] = useState("5");
  const [showCostInput, setShowCostInput] = useState(false);

  // Reward animation state
  const [rewardAnimation, setRewardAnimation] = useState<{
    amount: number;
    x: number;
    y: number;
    opacity: number;
    active: boolean;
  }>({
    amount: 0,
    x: 0,
    y: 0,
    opacity: 0,
    active: false
  });

  const GRAVITY = 0.25; // Balanced gravity for smoother falling
  const BOUNCE = 0.6; // Moderate bounce for natural deflection
  const FRICTION = 0.98; // Less friction for smoother movement

  // Initialize pegs and slots
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas dimensions to match window
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const width = canvas.width;

    // For random drops near the middle only
    const centerX = width / 2;
    
    // Store just the center point
    setDropPoints([centerX]);
    
    // Create an improved peg pattern with better offsets
    const newPegs: Peg[] = [];
    const rows = 14; // Increased for better pyramid shape
    const pegRadius = 4;
    const baseSpacing = 38; // Slightly reduced for tighter pattern
    
    // Calculate the number of pegs in the bottom row (to match with slots later)
    const bottomRowPegs = rows + 4; // This creates the width of the base
    
    // Calculate the total width of the triangle base
    const triangleBaseWidth = (bottomRowPegs - 1) * baseSpacing;
    
    // Track the bottom row positions for slot alignment
    const bottomRowPositions: number[] = [];
    
    for (let row = 0; row < rows; row++) {
      // Use triangle shape: fewer pegs at top, more at bottom, in arithmetic progression
      const pegsInRow = (row + 5); // Start with 5 pegs at top
      
      // Calculate total width needed for this row
      const totalWidth = (pegsInRow - 1) * baseSpacing;
      const startX = width / 2 - totalWidth / 2;
      
      // Use consistent vertical spacing
      const y = 100 + row * 42;
      
      // Apply zigzag pattern to create better offsets between rows
      // Create a different offset for each row to make paths more interesting
      let offset = 0;
      if (row % 3 === 0) offset = 0;
      else if (row % 3 === 1) offset = baseSpacing / 3;
      else offset = baseSpacing * 2/3;
      
      // Create each peg in this row
      for (let col = 0; col < pegsInRow; col++) {
        const pegX = startX + col * baseSpacing + offset;
        
        // Store positions of bottom row pegs for slot alignment
        if (row === rows - 1) {
          bottomRowPositions.push(pegX);
        }
        
        newPegs.push({
          x: pegX,
          y: y,
          radius: pegRadius
        });
      }
    }

    // Create slots that align with the triangle base
    // Use the bottom row peg positions to determine slot placement
    const numSlots = bottomRowPegs + 1; // One more slot than pegs in bottom row
    
    // Calculate the base width for slot alignment
    const baseWidth = triangleBaseWidth;
    
    // Calculate margins to center the slots under the triangle
    const slotsStartX = width / 2 - baseWidth / 2 - baseSpacing / 2;
    
    // Create slot multipliers based on position
    const slotMultipliers = Array(numSlots).fill(0).map((_, index) => {
      // Distance from center (0 = center, 1 = edge)
      const distFromCenter = Math.abs((index / (numSlots - 1)) * 2 - 1);
      
      // Higher multipliers toward edges using exponential scaling
      if (distFromCenter > 0.9) {
        return 3.5; // Highest at the very edges
      } else if (distFromCenter > 0.75) {
        return 2.5; // High at outer edges
      } else if (distFromCenter > 0.5) {
        return 1.5; // Medium high at middle-outer area
      } else if (distFromCenter > 0.25) {
        return 0.8; // Lower in the middle-inner area
      } else {
        return 0.5; // Lowest at center
      }
    });
    
    // Create slots aligned with the triangle base
    const slotWidth = baseSpacing;
    const newSlots: Slot[] = slotMultipliers.map((multiplier, index) => {
      // Calculate slot positions based on the triangle base
      const x = slotsStartX + index * slotWidth;
      
      return {
        x,
        width: slotWidth,
        multiplier,
        color: multiplier >= 2.5 ? '#ff8844' : multiplier >= 1.5 ? '#ffaa44' : multiplier >= 1.0 ? '#44aa44' : multiplier >= 0.7 ? '#aa4444' : '#ff4444',
        collected: 0
      };
    });

    setPegs(newPegs);
    setSlots(newSlots);
  }, []);

  // Physics and rendering
  const updatePhysics = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setBalls(prevBalls => {
      const updatedBalls = prevBalls.map(ball => {
        let newBall = { ...ball };
        
        // Apply gravity
        newBall.vy += GRAVITY;
        
        // Update position
        newBall.x += newBall.vx;
        newBall.y += newBall.vy;
        
        // Apply friction
        newBall.vx *= FRICTION;
        newBall.vy *= FRICTION;
        
        // Collision with pegs - improved to be smoother and less sticky
        pegs.forEach(peg => {
          const dx = newBall.x - peg.x;
          const dy = newBall.y - peg.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const minDistance = newBall.radius + peg.radius + 0.5; // Add a small buffer
          
          if (distance < minDistance) {
            // Calculate collision response with normalized vectors for more accuracy
            const nx = dx / distance; // Normalized x direction
            const ny = dy / distance; // Normalized y direction
            
            // Dot product of velocity and normal vector
            const dotProduct = newBall.vx * nx + newBall.vy * ny;
            
            // Reflect velocity vector with proper bounce
            newBall.vx = (newBall.vx - 2 * dotProduct * nx) * BOUNCE;
            newBall.vy = (newBall.vy - 2 * dotProduct * ny) * BOUNCE;
            
            // Add tiny directional bias toward the edges to encourage wider spread
            const edgeBias = (peg.x < canvas.width / 2) ? -0.05 : 0.05;
            newBall.vx += edgeBias;
            
            // Separate from peg using the normalized vectors
            const overlap = minDistance - distance;
            newBall.x += nx * overlap;
            newBall.y += ny * overlap;
          }
        });
        
        // Wall collisions
        if (newBall.x - newBall.radius < 0) {
          newBall.x = newBall.radius;
          newBall.vx = -newBall.vx * BOUNCE;
        }
        if (newBall.x + newBall.radius > canvas.width) {
          newBall.x = canvas.width - newBall.radius;
          newBall.vx = -newBall.vx * BOUNCE;
        }
        
        return newBall;
      });
      
      // Check for balls that reached the bottom
      const activeBalls = updatedBalls.filter(ball => {
        if (ball.y > canvas.height - 80) {
          // Find which slot the ball landed in based on x position
          // Using the actual slot positions rather than dividing the canvas width
          let slotIndex = -1;
          for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (ball.x >= slot.x && ball.x < slot.x + slot.width) {
              slotIndex = i;
              break;
            }
          }
          
          // Handle edge case for rightmost slot
          if (slotIndex === -1 && ball.x >= slots[slots.length - 1].x) {
            slotIndex = slots.length - 1;
          }
          
          const slot = slotIndex !== -1 ? slots[slotIndex] : null;
          if (slot && onReward) {
            // Scale reward based on the ball price
            const reward = Math.round(dropCost * slot.multiplier);
            onReward(slot.multiplier, dropCost);
            
            // Update slot collection count
            setSlots(prevSlots => 
              prevSlots.map((s, i) => 
                i === slotIndex ? { ...s, collected: s.collected + 1 } : s
              )
            );
            
            // Show reward animation at the bottom of the screen
            setRewardAnimation({
              amount: reward,
              x: ball.x,
              y: canvas.height - 100,
              opacity: 1,
              active: true
            });
          }
          return false;
        }
        return true;
      });
      
      return activeBalls;
    });
  }, [pegs, slots, onReward, dropCost]);

  // Handle reward animation
  useEffect(() => {
    if (!rewardAnimation.active) return;
    
    const timer = setTimeout(() => {
      setRewardAnimation(prev => ({
        ...prev,
        opacity: prev.opacity - 0.05,
        y: prev.y - 1,
      }));
      
      if (rewardAnimation.opacity <= 0) {
        setRewardAnimation(prev => ({ ...prev, active: false }));
      }
    }, 50);
    
    return () => clearTimeout(timer);
  }, [rewardAnimation]);

  // Render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Clear canvas with gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(0.5, '#16213e');
    gradient.addColorStop(1, '#0f172a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw pegs
    pegs.forEach(peg => {
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd700';
      ctx.fill();
      ctx.strokeStyle = '#ffed4e';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // Add glow effect
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Draw slots aligned with the triangle base
    slots.forEach((slot) => {
      const x = slot.x;
      const y = canvas.height - 70; // Moved up slightly
      const width = slot.width;
      const height = 70; // Taller slots
      
      // Slot is positioned under the triangle base
      
      // Slot background with gradient
      const gradient = ctx.createLinearGradient(x, y, x, y + height);
      gradient.addColorStop(0, slot.color);
      gradient.addColorStop(1, adjustColor(slot.color, -30)); // Darker at bottom
      ctx.fillStyle = gradient;
      
      // Draw slot with angled top to fit between pegs
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width, y);
      ctx.lineTo(x + width, y + height);
      ctx.lineTo(x, y + height);
      ctx.closePath();
      ctx.fill();
      
      // Slot border
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // Add subtle highlight
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 2);
      ctx.lineTo(x + width - 2, y + 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.stroke();
      
      // Multiplier text with better visibility
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${slot.multiplier}x`, x + width / 2, y + 20);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 3;
      ctx.strokeText(`${slot.multiplier}x`, x + width / 2, y + 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(`${slot.multiplier}x`, x + width / 2, y + 20);
      
      // Potential win amount
      const potentialWin = Math.round(dropCost * slot.multiplier);
      ctx.font = '12px Arial';
      ctx.fillStyle = '#4eff4e';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${potentialWin}`, x + width / 2, y + 40);
      
      // Collection count
      if (slot.collected > 0) {
        ctx.font = '11px Arial';
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(`(${slot.collected})`, x + width / 2, y + 55);
      }
    });
    
    // Helper function to adjust color brightness
    function adjustColor(color: string, amount: number): string {
      const hex = color.replace('#', '');
      const r = Math.max(0, Math.min(255, parseInt(hex.substring(0, 2), 16) + amount));
      const g = Math.max(0, Math.min(255, parseInt(hex.substring(2, 4), 16) + amount));
      const b = Math.max(0, Math.min(255, parseInt(hex.substring(4, 6), 16) + amount));
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // Draw balls
    balls.forEach(ball => {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = ball.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Add glow
      ctx.shadowColor = ball.color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Draw drop zone indicator
    const dropZoneY = 50;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    
    // Draw horizontal line just in the middle section
    const centerX = canvas.width / 2;
    ctx.moveTo(centerX - 100, dropZoneY); // 100px to the left of center
    ctx.lineTo(centerX + 100, dropZoneY); // 100px to the right of center
    ctx.stroke();
    ctx.setLineDash([]);

    // Drop zone text
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('RANDOM DROP ZONE', canvas.width / 2, dropZoneY - 15);
    
    // Draw center indicator with animated effect
    const pulseSize = 6 + Math.sin(Date.now() * 0.01) * 2;
    
    // Draw central drop area
    ctx.beginPath();
    ctx.arc(centerX, dropZoneY, pulseSize, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 215, 0, 0.6)';
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    
    // Draw the random range indicator
    ctx.beginPath();
    ctx.moveTo(centerX - 50, dropZoneY + 10);
    ctx.lineTo(centerX + 50, dropZoneY + 10);
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Add small arrows to indicate random range
    ctx.beginPath();
    ctx.moveTo(centerX - 50, dropZoneY + 10);
    ctx.lineTo(centerX - 45, dropZoneY + 7);
    ctx.lineTo(centerX - 45, dropZoneY + 13);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 215, 0, 0.5)';
    ctx.fill();
    
    ctx.beginPath();
    ctx.moveTo(centerX + 50, dropZoneY + 10);
    ctx.lineTo(centerX + 45, dropZoneY + 7);
    ctx.lineTo(centerX + 45, dropZoneY + 13);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 215, 0, 0.5)';
    ctx.fill();

    // Draw reward animation if active
    if (rewardAnimation.active) {
      ctx.globalAlpha = rewardAnimation.opacity;
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`+${rewardAnimation.amount}`, rewardAnimation.x, rewardAnimation.y);
      ctx.globalAlpha = 1;
    }
  }, [balls, pegs, slots, rewardAnimation]);

  // Animation loop
  useEffect(() => {
    const animate = () => {
      updatePhysics();
      render();
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [updatePhysics, render]);

  // Drop ball function
  const dropBall = useCallback(() => {
    // Check if player has enough resources for the current drop cost
    if (isDropping || playerResources < dropCost || dropPoints.length === 0) return;
    
    setIsDropping(true);
    
    // Notify parent of resource use - use negative multiplier to indicate cost
    if (onReward) {
      onReward(-1, dropCost); // Use negative multiplier to indicate this is a cost
    }
    
    // Use the center point with a small random variation
    const centerX = dropPoints[0] || (canvasRef.current ? canvasRef.current.width / 2 : 400);
    
    // Create a wider range for drop positions to encourage use of the edges
    const randomOffset = (Math.random() * 200) - 100; // ±100 pixels from center
    
    // Final drop position with wider range
    const dropPosition = centerX + randomOffset;
    
    // Calculate initial velocity to encourage movement toward edges
    // If dropped on left side, slight bias to the left; if right, slight bias to right
    const edgeBias = (dropPosition < centerX) ? -0.2 : 0.2;
    
    const newBall: Ball = {
      id: Math.random().toString(36).substr(2, 9),
      x: dropPosition,
      y: 60,
      vx: ((Math.random() - 0.5) * 0.2) + edgeBias, // Add edge bias
      vy: 0.2, // Small initial downward velocity for more consistent start
      radius: 6,
      color: `hsl(${Math.random() * 360}, 70%, 60%)`
    };
    
    setBalls(prev => [...prev, newBall]);
    
    // Reset dropping state after a short delay
    setTimeout(() => setIsDropping(false), 500);
  }, [isDropping, playerResources, dropCost]);

  // Handle canvas click
  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement | HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to canvas coordinates
    const canvasX = (x / rect.width) * canvas.width;
    const canvasY = (y / rect.height) * canvas.height;
    
    // Define the Plinko area boundaries (center area of screen)
    const plinkoAreaLeft = canvas.width * 0.3;
    const plinkoAreaRight = canvas.width * 0.7;
    const plinkoAreaTop = 50;
    const plinkoAreaBottom = canvas.height * 0.9;
    
    // Only respond to clicks within the Plinko area
    if (canvasX >= plinkoAreaLeft && canvasX <= plinkoAreaRight && 
        canvasY >= plinkoAreaTop && canvasY <= plinkoAreaBottom) {
      // Only allow drops in the top area of the Plinko zone
      if (canvasY < 80) {
        dropBall();
      }
    }
    // Ignore clicks outside the Plinko area - let them pass through to game UI
  }, [dropBall]);

  return (
    <div className="plinko-board">
      <div className="drop-zone-indicator"></div>
      <div className="fair-play-notice">🎮 FAIR PLAY: Random Center Drops Only!</div>
      
      {/* Reward animation */}
      {rewardAnimation.active && (
        <div 
          className="reward-animation"
          style={{
            left: rewardAnimation.x,
            top: rewardAnimation.y,
            opacity: rewardAnimation.opacity,
          }}
        >
          +{rewardAnimation.amount}
        </div>
      )}
      
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className="plinko-canvas"
      />
      
      {/* Separate click zone for Plinko interaction */}
      <div 
        className="plinko-click-zone"
        onClick={handleCanvasClick}
      ></div>
      <div className="plinko-controls">
        <div className="plinko-info">
          <div className="player-balance">💰 Balance: <span className="balance-value">{playerResources}</span> coins</div>
          
          {showCostInput ? (
            <div className="cost-input-container">
              <input
                type="number"
                min="1"
                max={playerResources}
                value={inputCost}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!isNaN(value) && value > 0 && value <= playerResources) {
                    setInputCost(e.target.value);
                  } else if (e.target.value === "") {
                    setInputCost("");
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const value = parseInt(inputCost);
                    if (!isNaN(value) && value > 0 && value <= playerResources) {
                      setDropCost(value);
                      setShowCostInput(false);
                    }
                  }
                }}
                onBlur={() => {
                  const value = parseInt(inputCost);
                  if (!isNaN(value) && value > 0 && value <= playerResources) {
                    setDropCost(value);
                  } else {
                    setInputCost(dropCost.toString());
                  }
                  setShowCostInput(false);
                }}
                className="cost-input"
                autoFocus
              />
              <button 
                className="set-cost-button"
                onClick={() => {
                  const value = parseInt(inputCost);
                  if (!isNaN(value) && value > 0 && value <= playerResources) {
                    setDropCost(value);
                    setShowCostInput(false);
                  }
                }}
              >
                Set
              </button>
            </div>
          ) : (
            <>
              <div className="drop-cost" onClick={() => setShowCostInput(true)}>
                Ball Price: <span className="cost-value">{dropCost}</span> coins (click to change)
              </div>
              <div className="bet-presets">
                {[5, 10, 25, 50, 100].map((amount) => (
                  <button
                    key={amount}
                    className={`preset-button ${dropCost === amount ? 'active' : ''}`}
                    onClick={() => playerResources >= amount && setDropCost(amount)}
                    disabled={playerResources < amount}
                  >
                    {amount}
                  </button>
                ))}
              </div>
            </>
          )}
          
          <span className="instructions">Click at top to drop ball!</span>
        </div>
      </div>
    </div>
  );
};

export default PlinkoBoard;
