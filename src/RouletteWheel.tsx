import React, { useState, useRef } from 'react';
import './RouletteWheel.css';

interface RouletteWheelProps {
  onSpin?: (result: number, winnings: number) => void;
  playerResources: number;
  onBet?: (betAmount: number, betType: string, betValue?: number) => void;
}

const RouletteWheel: React.FC<RouletteWheelProps> = ({ onSpin, playerResources, onBet }) => {
  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [betAmount, setBetAmount] = useState(10);
  const [betType, setBetType] = useState<'number' | 'color' | 'oddeven'>('color');
  const [betValue, setBetValue] = useState<string>('red');
  const [lastWinnings, setLastWinnings] = useState<number>(0);
  const [position, setPosition] = useState({ x: window.innerWidth - 320, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isMinimized, setIsMinimized] = useState(false);
  const wheelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // European roulette numbers in correct order on the wheel
  const numbers = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
    24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
  ];

  // Handle dragging functionality
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('window-header')) {
      setIsDragging(true);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setDragOffset({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        });
      }
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      const newX = Math.max(0, Math.min(window.innerWidth - 300, e.clientX - dragOffset.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y));
      setPosition({ x: newX, y: newY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Add global mouse event listeners
  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);
  // Generate the conic gradient based on actual number sequence
  const generateWheelGradient = () => {
    const sectionAngle = 360 / numbers.length;
    const gradientStops = [];
    
    for (let i = 0; i < numbers.length; i++) {
      const startAngle = i * sectionAngle;
      const endAngle = (i + 1) * sectionAngle;
      const color = getNumberColor(numbers[i]);
      const cssColor = color === 'red' ? '#dc143c' : color === 'black' ? '#2c2c2c' : '#228b22';
      
      // Make sure the gradient sections align with the visual sections
      gradientStops.push(`${cssColor} ${startAngle}deg ${endAngle}deg`);
    }
    
    return `conic-gradient(from 0deg, ${gradientStops.join(', ')})`;
  };

  // Handle window resize
  React.useEffect(() => {
    const handleResize = () => {
      setPosition(prev => ({
        x: Math.min(prev.x, window.innerWidth - 300),
        y: Math.min(prev.y, window.innerHeight - 100)
      }));
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getNumberColor = (num: number): string => {
    if (num === 0) return 'green';
    const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    return redNumbers.includes(num) ? 'red' : 'black';
  };

  const calculateWinnings = (landedNumber: number): number => {
    if (betAmount > playerResources) return 0;

    let winnings = 0;
    
    switch (betType) {
      case 'number':
        if (parseInt(betValue) === landedNumber) {
          winnings = betAmount * 35; // 35:1 payout for exact number
        }
        break;
      case 'color':
        if (getNumberColor(landedNumber) === betValue) {
          winnings = betAmount * 2; // 1:1 payout for color
        }
        break;
      case 'oddeven':
        const isEven = landedNumber !== 0 && landedNumber % 2 === 0;
        const isOdd = landedNumber !== 0 && landedNumber % 2 === 1;
        if ((betValue === 'even' && isEven) || (betValue === 'odd' && isOdd)) {
          winnings = betAmount * 2; // 1:1 payout for odd/even
        }
        break;
    }
    
    return winnings;
  };  const spinWheel = () => {
    if (isSpinning || betAmount > playerResources || betAmount <= 0) return;
    
    setIsSpinning(true);
    setResult(null);
    setLastWinnings(0);
    
    // Place the bet
    onBet?.(betAmount, betType, betType === 'number' ? parseInt(betValue) : undefined);
    
    // Generate random rotation (multiple full rotations + random angle)
    const minSpins = 3;
    const maxSpins = 6;
    const spins = Math.random() * (maxSpins - minSpins) + minSpins;
    
    // COMPLETELY NEW APPROACH:
    // Let's work backwards from what we want to happen
    // 1. Pick a random number first
    const randomIndex = Math.floor(Math.random() * numbers.length);
    const targetNumber = numbers[randomIndex];
    
    // 2. Calculate what angle the wheel needs to stop at for that number to be under the pointer
    const sectionAngle = 360 / numbers.length;
    
    // The number at index 0 starts at 0 degrees, index 1 at sectionAngle degrees, etc.
    // We want the center of the target section to be at the top (under the pointer)
    const targetAngle = randomIndex * sectionAngle + (sectionAngle / 2);
    
    // 3. Calculate the rotation needed to get there
    // If we want targetAngle to end up at 0 degrees (top), we need to rotate by (360 - targetAngle)
    const adjustedFinalAngle = (360 - targetAngle) % 360;
    const adjustedTotalRotation = spins * 360 + adjustedFinalAngle;
    
    console.log(`Target: ${targetNumber} (${getNumberColor(targetNumber)}), Index: ${randomIndex}, TargetAngle: ${targetAngle}, FinalRotation: ${adjustedTotalRotation}`);
    
    if (wheelRef.current) {
      wheelRef.current.style.transform = `rotate(${adjustedTotalRotation}deg)`;
    }
    
    setTimeout(() => {
      const winnings = calculateWinnings(targetNumber);
      setIsSpinning(false);
      setResult(targetNumber);
      setLastWinnings(winnings);
      onSpin?.(targetNumber, winnings);
    }, 3000);
  };

  return (
    <div 
      ref={containerRef}
      className={`roulette-window ${isDragging ? 'dragging' : ''} ${isMinimized ? 'minimized' : ''}`}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div 
        className="window-header"
        onMouseDown={handleMouseDown}
      >
        <div className="window-title">🎰 Casino Roulette</div>
        <div className="window-controls">
          <button 
            className="minimize-btn"
            onClick={() => setIsMinimized(!isMinimized)}
          >
            {isMinimized ? '□' : '_'}
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="window-content">
          <div className="roulette-wheel-wrapper">
            <div className="roulette-pointer"></div>
            <div 
              ref={wheelRef}
              className="roulette-wheel"
              style={{
                background: generateWheelGradient()
              }}
            >              {numbers.map((number, index) => {
                // Position each number at the start of its section
                // Section i goes from (i * sectionAngle) to ((i+1) * sectionAngle)
                const angle = (index * 360) / numbers.length;
                const centerOffset = (360 / numbers.length) / 2; // Center the number in the section
                return (
                  <div
                    key={`${number}-${index}`}
                    className="roulette-number-container"
                    style={{
                      // Position the number at the center of its section
                      transform: `rotate(${angle + centerOffset}deg)`,
                    }}
                  >
                    <div 
                      className="roulette-number"
                      style={{
                        // Keep the number upright
                        transform: `rotate(${-(angle + centerOffset)}deg)`,
                        color: '#fff',
                        fontWeight: 'bold',
                        fontSize: '12px'
                      }}
                    >
                      {number}
                    </div>
                  </div>
                );
              })}
              <div className="wheel-rim"></div>
            </div>
            <div className="roulette-center">
              <div className="center-logo">🎲</div>
            </div>
          </div>
          
          <div className="roulette-controls">
            {/* Betting Interface */}
            <div className="betting-section">
              <div className="resources-display">
                💰 {playerResources} coins
              </div>
              
              <div className="bet-amount-section">
                <label>Bet Amount:</label>
                <div className="bet-amount-controls">
                  <button 
                    className="bet-btn" 
                    onClick={() => setBetAmount(Math.max(1, betAmount - 5))}
                    disabled={isSpinning}
                  >
                    -5
                  </button>
                  <input 
                    type="number" 
                    value={betAmount} 
                    onChange={(e) => setBetAmount(Math.max(1, Math.min(playerResources, parseInt(e.target.value) || 1)))}
                    min="1" 
                    max={playerResources}
                    disabled={isSpinning}
                    className="bet-input"
                  />
                  <button 
                    className="bet-btn" 
                    onClick={() => setBetAmount(Math.min(playerResources, betAmount + 5))}
                    disabled={isSpinning}
                  >
                    +5
                  </button>
                </div>
              </div>

              <div className="bet-type-section">
                <label>Bet Type:</label>
                <select 
                  value={betType} 
                  onChange={(e) => setBetType(e.target.value as 'number' | 'color' | 'oddeven')}
                  disabled={isSpinning}
                  className="bet-select"
                >
                  <option value="color">Color</option>
                  <option value="oddeven">Odd/Even</option>
                  <option value="number">Number</option>
                </select>
              </div>              <div className="bet-value-section">
                <label>Current Bet: <strong>{betType === 'color' ? betValue.toUpperCase() : betType === 'oddeven' ? betValue.toUpperCase() : `Number ${betValue}`}</strong></label>
                {betType === 'color' && (
                  <div className="color-buttons">
                    <button 
                      className={`color-bet-btn red ${betValue === 'red' ? 'selected' : ''}`}
                      onClick={() => setBetValue('red')}
                      disabled={isSpinning}
                    >
                      🔴 Red (2:1)
                    </button>
                    <button 
                      className={`color-bet-btn black ${betValue === 'black' ? 'selected' : ''}`}
                      onClick={() => setBetValue('black')}
                      disabled={isSpinning}
                    >
                      ⚫ Black (2:1)
                    </button>
                  </div>
                )}
                
                {betType === 'oddeven' && (
                  <div className="oddeven-buttons">
                    <button 
                      className={`oddeven-bet-btn ${betValue === 'odd' ? 'selected' : ''}`}
                      onClick={() => setBetValue('odd')}
                      disabled={isSpinning}
                    >
                      🔢 Odd (2:1)
                    </button>
                    <button 
                      className={`oddeven-bet-btn ${betValue === 'even' ? 'selected' : ''}`}
                      onClick={() => setBetValue('even')}
                      disabled={isSpinning}
                    >
                      🔢 Even (2:1)
                    </button>
                  </div>
                )}
                
                {betType === 'number' && (
                  <input 
                    type="number" 
                    value={betValue} 
                    onChange={(e) => setBetValue(e.target.value)}
                    min="0" 
                    max="36"
                    disabled={isSpinning}
                    className="number-input"
                    placeholder="0-36 (35:1)"
                  />
                )}
              </div>
            </div>

            <button 
              className={`spin-button ${isSpinning ? 'spinning' : ''} ${betAmount > playerResources ? 'disabled' : ''}`}
              onClick={spinWheel}
              disabled={isSpinning || betAmount > playerResources || betAmount <= 0}
            >
              {isSpinning ? 'Spinning...' : `SPIN (${betAmount} coins)`}
            </button>
            
            {result !== null && (
              <div className={`result ${getNumberColor(result)}`}>
                <div className="result-label">Result:</div>
                <div className="result-number">{result}</div>
                <div className="result-color">{getNumberColor(result).toUpperCase()}</div>
                {lastWinnings > 0 ? (
                  <div className="winnings">🎉 Won {lastWinnings} coins!</div>
                ) : (
                  <div className="loss">Lost {betAmount} coins</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RouletteWheel;
