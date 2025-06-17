import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from the dist directory
app.use(express.static(join(__dirname, 'dist')));

// Game state
const games = new Map();

class Game {
    constructor(id) {
        this.id = id;
        this.players = [];
        this.units = [];
        this.currentPlayer = 0;
        this.gameOver = false;
        this.winner = null;
        this.playerResources = {};
        this.playerSelectedLane = {}; // Fixed syntax error
        this.playerBases = {};
        this.lastResourceUpdate = Date.now();
        this.gameLoop = null;
        this.baseAttackCooldowns = {}; // Track last attack time for each base
        this.attackAnimations = []; // Track active attack animations
        this.traps = []; // Track placed traps
        this.turrets = []; // Track placed turrets
        this.mines = []; // Track placed mines
        this.turretAttackCooldowns = {}; // Track turret attack cooldowns
        this.resourceGenerationRate = 10; // Start at 10 (slower)
        this.resourceGenerationIncreaseInterval = 20000; // 20 seconds
        this.lastResourceIncrease = Date.now();
    }

    addPlayer(playerId, playerName) {
        if (this.players.length < 2) {
            const armyNames = ['KNIGHTS', 'ORCS'];
            const colors = ['#3498db', '#e74c3c'];
            const basePositions = [75, 1125];

            const player = {
                id: playerId,
                name: playerName,
                army: armyNames[this.players.length],
                color: colors[this.players.length]
            };

            this.players.push(player);
            this.playerResources[playerId] = 500; // Starting resources
            this.playerBases[playerId] = {
                health: 1000,
                maxHealth: 1000,
                x: basePositions[this.players.length - 1],
                y: 300 // Center of 600px height canvas (600/2 = 300)
            };
            this.playerSelectedLane[playerId] = 0; // Default lane

            // Start game loop when 2 players join
            if (this.players.length === 2 && !this.gameLoop) {
                this.startGameLoop();
            }

            return true;
        }
        return false;
    }

    createAttackAnimation(attackerX, attackerY, targetX, targetY, animationType = 'projectile') {
        const animation = {
            id: `attack_${Date.now()}_${Math.random()}`,
            fromX: attackerX,
            fromY: attackerY,
            toX: targetX,
            toY: targetY,
            type: animationType, // 'projectile', 'melee', 'base'
            startTime: Date.now(),
            duration: 300 // Animation duration in ms
        };
        this.attackAnimations.push(animation);
        return animation;
    }

    updateAttackAnimations() {
        const now = Date.now();
        this.attackAnimations = this.attackAnimations.filter(anim => 
            now - anim.startTime < anim.duration
        );
    }

    processChainLightning(wizard, primaryTarget, attackTime) {
        // Find additional chain lightning targets
        const chainTargets = this.units
            .filter(unit => {
                // Exclude the wizard's team, the primary target, and dead units
                return unit.playerId !== wizard.playerId && 
                       unit.id !== primaryTarget.id &&
                       unit.health > 0;
            })
            .filter(unit => {
                // Check if unit is within chain lightning range of wizard
                const distance = Math.sqrt(
                    Math.pow(unit.x - wizard.x, 2) + Math.pow(unit.y - wizard.y, 2)
                );
                return distance <= (wizard.chainLightningRange || 0);
            })
            .sort((a, b) => {
                // Sort by distance to wizard (closest first)
                const distA = Math.sqrt(Math.pow(a.x - wizard.x, 2) + Math.pow(a.y - wizard.y, 2));
                const distB = Math.sqrt(Math.pow(b.x - wizard.x, 2) + Math.pow(b.y - wizard.y, 2));
                return distA - distB;
            })
            .slice(0, (wizard.chainLightningTargets || 3) - 1); // -1 because primary target is already hit

        // Apply chain lightning damage (decreasing with each jump)
        chainTargets.forEach((target, index) => {
            // Damage decreases by 20% with each chain jump
            const damageMultiplier = Math.pow(0.8, index + 1);
            const chainDamage = Math.floor(wizard.damage * damageMultiplier);
            
            // Create chain lightning animation with slight delay
            setTimeout(() => {
                this.createAttackAnimation(wizard.x, wizard.y, target.x, target.y, 'chain_lightning');
            }, (index + 1) * 100); // Stagger animations by 100ms
            
            // Apply damage
            target.health = Math.max(0, target.health - chainDamage);
            
            // Check if target dies and award resources
            if (target.health <= 0) {
                const targetIndex = this.units.indexOf(target);
                if (targetIndex > -1) {
                    const unitReward = {
                        'Peasant': 10,
                        'Knight': 40,
                        'Archer': 80,
                        'King': 150,
                        'Wizard': 120
                    };
                    const reward = Math.floor((unitReward[target.unitType] || 10) * 0.5); // Half reward for chain kills
                    this.playerResources[wizard.playerId] = (this.playerResources[wizard.playerId] || 0) + reward;
                    
                    // Delay removal to allow animation
                    setTimeout(() => {
                        const currentIndex = this.units.indexOf(target);
                        if (currentIndex > -1) {
                            this.units.splice(currentIndex, 1);
                        }
                    }, 200);
                }
            }
        });
    }

    placeTrap(playerId, x, y) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return false;

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        const TRAP_COST = 50; // Cost to place a trap
        
        // Check if player has enough resources
        if (this.playerResources[playerId] < TRAP_COST) return false;

        // Check if position is on player's own half
        const CANVAS_WIDTH = 1200;
        const playerHalfStart = playerIndex === 0 ? 0 : CANVAS_WIDTH / 2;
        const playerHalfEnd = playerIndex === 0 ? CANVAS_WIDTH / 2 : CANVAS_WIDTH;
        
        if (x < playerHalfStart || x > playerHalfEnd) return false;

        // Check if there's already a trap at this location (within 30px)
        const existingTrap = this.traps.find(trap => 
            Math.abs(trap.x - x) < 30 && Math.abs(trap.y - y) < 30
        );
        if (existingTrap) return false;

        // Deduct resources and place trap
        this.playerResources[playerId] -= TRAP_COST;
        
        const trap = {
            id: `trap_${Date.now()}_${Math.random()}`,
            x: x,
            y: y,
            playerId: playerId,
            damage: 30,
            triggered: false,
            type: 'spike' // Could have different trap types later
        };

        this.traps.push(trap);
        return true;
    }

    placeTurret(playerId, x, y) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return false;

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        const TURRET_COST = 125; // Cost to place a turret
        
        // Check if player has enough resources
        if (this.playerResources[playerId] < TURRET_COST) return false;

        // Check if position is on player's own half
        const CANVAS_WIDTH = 1200;
        const playerHalfStart = playerIndex === 0 ? 0 : CANVAS_WIDTH / 2;
        const playerHalfEnd = playerIndex === 0 ? CANVAS_WIDTH / 2 : CANVAS_WIDTH;
        
        if (x < playerHalfStart || x > playerHalfEnd) return false;

        // Check if there's already a structure at this location (within 40px)
        const existingStructure = [...this.traps, ...this.turrets, ...this.mines].find(structure => 
            Math.abs(structure.x - x) < 40 && Math.abs(structure.y - y) < 40
        );
        if (existingStructure) return false;

        // Deduct resources and place turret
        this.playerResources[playerId] -= TURRET_COST;
        
        const turret = {
            id: `turret_${Date.now()}_${Math.random()}`,
            x: x,
            y: y,
            playerId: playerId,
            health: 100,
            maxHealth: 100,
            damage: 15,
            attackRange: 140,
            attackCooldown: 800,
            lastAttackTime: 0,
            type: 'turret'
        };

        this.turrets.push(turret);
        return true;
    }

    placeMine(playerId, x, y) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return false;

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        const MINE_COST = 75; // Cost to place a mine
        
        // Check if player has enough resources
        if (this.playerResources[playerId] < MINE_COST) return false;

        // Check if position is on player's own half
        const CANVAS_WIDTH = 1200;
        const playerHalfStart = playerIndex === 0 ? 0 : CANVAS_WIDTH / 2;
        const playerHalfEnd = playerIndex === 0 ? CANVAS_WIDTH / 2 : CANVAS_WIDTH;
        
        if (x < playerHalfStart || x > playerHalfEnd) return false;

        // Check if there's already a structure at this location (within 35px)
        const existingStructure = [...this.traps, ...this.turrets, ...this.mines].find(structure => 
            Math.abs(structure.x - x) < 35 && Math.abs(structure.y - y) < 35
        );
        if (existingStructure) return false;

        // Deduct resources and place mine
        this.playerResources[playerId] -= MINE_COST;
        
        const mine = {
            id: `mine_${Date.now()}_${Math.random()}`,
            x: x,
            y: y,
            playerId: playerId,
            damage: 50,
            explosionRadius: 45,
            triggered: false,
            type: 'mine'
        };

        this.mines.push(mine);
        return true;
    }

    checkTrapCollisions() {
        // Check if any units stepped on traps
        this.units.forEach(unit => {
            this.traps.forEach(trap => {
                if (trap.triggered || trap.playerId === unit.playerId) return;
                
                // Check if unit is close enough to trigger trap
                const distance = Math.sqrt(
                    Math.pow(unit.x - trap.x, 2) + Math.pow(unit.y - trap.y, 2)
                );
                
                if (distance < 20) { // Trap trigger radius
                    // Trigger trap
                    trap.triggered = true;
                    unit.health = Math.max(0, unit.health - trap.damage);
                    
                    // Create explosion animation
                    this.createAttackAnimation(trap.x, trap.y, trap.x, trap.y, 'explosion');
                    
                    // Remove unit if dead
                    if (unit.health <= 0) {
                        const unitIndex = this.units.indexOf(unit);
                        if (unitIndex > -1) {
                            // === Award resources for kill ===
                            const unitReward = {
                                'Peasant': 10,
                                'Knight': 40,
                                'Archer': 80,
                                'King': 150
                            };
                            const reward = unitReward[unit.unitType] || 10;
                            this.playerResources[unit.playerId] = (this.playerResources[unit.playerId] || 0) + reward
                            this.units.splice(unitIndex, 1);
                        }
                    }
                }
            });
        });

        // Remove triggered traps after a short delay
        this.traps = this.traps.filter(trap => !trap.triggered);
    }

    checkMineCollisions() {
        // Check mine collisions
        this.units.forEach(unit => {
            this.mines.forEach(mine => {
                if (mine.triggered || mine.playerId === unit.playerId) return;
                
                // Check if unit is close enough to trigger mine
                const distance = Math.sqrt(
                    Math.pow(unit.x - mine.x, 2) + Math.pow(unit.y - mine.y, 2)
                );
                
                if (distance < 25) { // Mine trigger radius
                    // Trigger mine
                    mine.triggered = true;
                    
                    // Create mine explosion animation
                    this.createAttackAnimation(mine.x, mine.y, mine.x, mine.y, 'mine_explosion');
                    
                    // Damage all units within explosion radius
                    this.units.forEach(targetUnit => {
                        if (targetUnit.playerId === mine.playerId) return; // Don't damage own units
                        
                        const explosionDistance = Math.sqrt(
                            Math.pow(targetUnit.x - mine.x, 2) + Math.pow(targetUnit.y - mine.y, 2)
                        );
                        
                        if (explosionDistance <= mine.explosionRadius) {
                            targetUnit.health = Math.max(0, targetUnit.health - mine.damage);
                        }
                    });
                }
            });
        });

        // Remove triggered mines
        this.mines = this.mines.filter(mine => !mine.triggered);
    }

    updateTurretAttacks() {
        // Handle turret attacks
        this.turrets.forEach(turret => {
            // Find enemy units in range
            const now = Date.now();
            if (now - turret.lastAttackTime >= turret.attackCooldown) {
                const enemyUnits = this.units.filter(unit => {
                    if (unit.playerId === turret.playerId) return false;
                    
                    const distance = Math.sqrt(
                        Math.pow(unit.x - turret.x, 2) + Math.pow(unit.y - turret.y, 2)
                    );
                    
                    return distance <= turret.attackRange;
                });

                if (enemyUnits.length > 0) {
                    // Attack the closest enemy unit
                    let closest = enemyUnits[0];
                    let minDist = Math.sqrt(
                        Math.pow(closest.x - turret.x, 2) + Math.pow(closest.y - turret.y, 2)
                    );
                    
                    for (const unit of enemyUnits) {
                        const dist = Math.sqrt(
                            Math.pow(unit.x - turret.x, 2) + Math.pow(unit.y - turret.y, 2)
                        );
                        if (dist < minDist) {
                            closest = unit;
                            minDist = dist;
                        }
                    }
                    
                    // Create turret attack animation
                    this.createAttackAnimation(turret.x, turret.y, closest.x, closest.y, 'turret');
                    
                    closest.health = Math.max(0, closest.health - turret.damage);
                    turret.lastAttackTime = now;

                    // Remove unit if dead
                    if (closest.health <= 0) {
                        const idx = this.units.indexOf(closest);
                        if (idx > -1) {
                            // Award resources for kill
                            const unitReward = {
                                'Peasant': 10,
                                'Knight': 40,
                                'Archer': 80,
                                'King': 150
                            };
                            const reward = unitReward[closest.unitType] || 10;
                            this.playerResources[turret.playerId] = (this.playerResources[turret.playerId] || 0) + reward
                            this.units.splice(idx, 1);
                        }
                    }
                }
            }
        });

        // Remove destroyed turrets (when units attack them)
        this.turrets.forEach((turret, index) => {
            this.units.forEach(unit => {
                if (unit.playerId === turret.playerId) return;
                
                const distance = Math.sqrt(
                    Math.pow(unit.x - turret.x, 2) + Math.pow(unit.y - turret.y, 2)
                );
                
                // If unit is in range of turret, attack it
                if (distance <= unit.attackRange) {
                    const now = Date.now();
                    if (now - unit.lastAttackTime >= unit.attackCooldown) {
                        // Create attack animation
                        const animationType = unit.attackRange > 100 ? 'projectile' : 'melee';
                        this.createAttackAnimation(unit.x, unit.y, turret.x, turret.y, animationType);
                        
                        turret.health = Math.max(0, turret.health - unit.damage);
                        unit.lastAttackTime = now;
                        
                        // Remove turret if destroyed
                        if (turret.health <= 0) {
                            this.turrets.splice(index, 1);
                        }
                    }
                }
            });
        });
    }

    startGameLoop() {
        this.gameLoop = setInterval(() => {
            this.updateGame();
        }, 100); // Update every 100ms
    }

    stopGameLoop() {
        if (this.gameLoop) {
            clearInterval(this.gameLoop);
            this.gameLoop = null;
        }
    }

    updateGame() {
        // Update attack animations
        this.updateAttackAnimations();

        // Check trap collisions
        this.checkTrapCollisions();

        // Check mine collisions  
        this.checkMineCollisions();

        // Update turret attacks
        this.updateTurretAttacks();

        // === Increase resource generation rate by 0.5 every 2 seconds (slower) ===
        const now = Date.now();
        if (now - this.lastResourceIncrease > 2000) { // Every 2 seconds
            this.resourceGenerationRate += 0.5; // Slower increase
            this.lastResourceIncrease = now;
        }

        // === Generate resources over time ===
        if (now - this.lastResourceUpdate > 1000) { // Every second
            this.players.forEach(player => {
                this.playerResources[player.id] =
                    (this.playerResources[player.id] || 0) + this.resourceGenerationRate;
            });
            this.lastResourceUpdate = now;
        }

        // Move units and handle combat
        this.units.forEach((unit, index) => {
            const player = this.players.find(p => p.id === unit.playerId);
            const enemyPlayer = this.players.find(p => p.id !== unit.playerId);
            if (!player || !enemyPlayer) return;

            // Find targets (enemy units or base)
            let target = null;
            let minDistance = Infinity;

            // Check for enemy units
            this.units.forEach(enemyUnit => {
                if (
                    enemyUnit.playerId !== unit.playerId &&
                    enemyUnit.lane === unit.lane // Only interact if in same lane
                ) {
                    const distance = Math.abs(unit.x - enemyUnit.x);
                    if (distance < minDistance && distance < unit.attackRange) {
                        minDistance = distance;
                        target = enemyUnit;
                    }
                }
            });

            // If no enemy units, target enemy base
            if (!target) {
                const enemyBase = this.playerBases[enemyPlayer.id];
                const distanceToBase = Math.abs(unit.x - enemyBase.x);
                if (distanceToBase < unit.attackRange) {
                    target = 'base';
                }
            }

            if (target === 'base') {
                // Attack enemy base (with cooldown)
                const now = Date.now();
                if (now - unit.lastAttackTime >= unit.attackCooldown) {
                    const enemyBase = this.playerBases[enemyPlayer.id];
                    
                    // Create attack animation
                    const animationType = unit.attackRange > 100 ? 'projectile' : 'melee';
                    this.createAttackAnimation(unit.x, unit.y, enemyBase.x, enemyBase.y, animationType);
                    
                    enemyBase.health = Math.max(0, enemyBase.health - unit.damage);
                    unit.lastAttackTime = now;

                    if (enemyBase.health <= 0) {
                        this.gameOver = true;
                        this.winner = player;
                        this.stopGameLoop();
                    }
                }
            } else if (target) {
                // Attack enemy unit (with cooldown)
                const now = Date.now();
                if (now - unit.lastAttackTime >= unit.attackCooldown) {
                    // Create attack animation
                    const animationType = unit.attackRange > 100 ? 'projectile' : 'melee';
                    this.createAttackAnimation(unit.x, unit.y, target.x, target.y, animationType);
                    
                    // Calculate enhanced damage with special abilities
                    let finalDamage = unit.damage;
                    
                    // King Aura Bonus: Increase damage if near friendly King
                    const nearbyKings = this.units.filter(ally => 
                        ally.playerId === unit.playerId && 
                        ally.unitType === 'King' && 
                        ally.id !== unit.id &&
                        Math.sqrt(Math.pow(ally.x - unit.x, 2) + Math.pow(ally.y - unit.y, 2)) <= 80
                    );
                    if (nearbyKings.length > 0) {
                        finalDamage *= 1.3; // 30% damage bonus
                        // Create aura effect animation
                        this.createAttackAnimation(unit.x, unit.y, unit.x, unit.y, 'aura_boost');
                    }
                    
                    // Archer Critical Hit: 15% chance for double damage
                    if (unit.unitType === 'Archer' && Math.random() < 0.15) {
                        finalDamage *= 2;
                        // Create critical hit animation
                        this.createAttackAnimation(unit.x, unit.y, target.x, target.y, 'critical_hit');
                    }
                    
                    // Knight Armor: Reduce incoming damage by 20%
                    if (target.unitType === 'Knight') {
                        finalDamage *= 0.8; // 20% damage reduction
                    }
                    
                    // Apply final damage to primary target
                    target.health = Math.max(0, target.health - finalDamage);
                    unit.lastAttackTime = now;
                    
                    // Handle Chain Lightning for Wizard units
                    if (unit.unitType === 'Wizard' && unit.chainLightningRange && unit.chainLightningTargets) {
                        this.processChainLightning(unit, target, now);
                    }
                    
                    if (target.health <= 0) {
                        const targetIndex = this.units.indexOf(target);
                        if (targetIndex > -1) {
                            // === Award resources for kill ===
                            const unitReward = {
                                'Peasant': 10,
                                'Knight': 40,
                                'Archer': 80,
                                'King': 150,
                                'Wizard': 120
                            };
                            const reward = unitReward[target.unitType] || 10;
                            this.playerResources[unit.playerId] = (this.playerResources[unit.playerId] || 0) + reward
                            this.units.splice(targetIndex, 1);
                        }
                    }
                }
            } else {
                // Move towards enemy base
                const enemyBase = this.playerBases[enemyPlayer.id];
                const direction = unit.x < enemyBase.x ? 1 : -1;
                unit.x += unit.speed * direction;

                // Keep units on screen
                unit.x = Math.max(25, Math.min(1175, unit.x));
            }
        });

        // === BASE (TOWER) ATTACK LOGIC ===
        const BASE_ATTACK_RANGE = 120;
        const BASE_ATTACK_DAMAGE = 10;
        const BASE_ATTACK_COOLDOWN = 1200; // ms

        this.players.forEach(player => {
            const base = this.playerBases[player.id];
            if (!base) return;

            // Initialize cooldown tracker if needed
            if (!this.baseAttackCooldowns[player.id]) {
                this.baseAttackCooldowns[player.id] = 0;
            }

            // Find enemy units in range
            const now = Date.now();
            if (now - this.baseAttackCooldowns[player.id] >= BASE_ATTACK_COOLDOWN) {
                const enemyUnits = this.units.filter(
                    unit =>
                        unit.playerId !== player.id &&
                        Math.abs(unit.x - base.x) <= BASE_ATTACK_RANGE &&
                        // Optional: Only attack units in the same vertical area as the base
                        Math.abs(unit.y - 300) < 300 // covers all lanes
                );
                if (enemyUnits.length > 0) {
                    // Attack the closest enemy unit
                    let closest = enemyUnits[0];
                    let minDist = Math.abs(closest.x - base.x);
                    for (const unit of enemyUnits) {
                        const dist = Math.abs(unit.x - base.x);
                        if (dist < minDist) {
                            closest = unit;
                            minDist = dist;
                        }
                    }
                    
                    // Create base attack animation
                    this.createAttackAnimation(base.x, base.y, closest.x, closest.y, 'base');
                    
                    closest.health = Math.max(0, closest.health - BASE_ATTACK_DAMAGE);
                    this.baseAttackCooldowns[player.id] = now;

                    // Remove unit if dead
                    if (closest.health <= 0) {
                        const idx = this.units.indexOf(closest);
                        if (idx > -1) this.units.splice(idx, 1);
                    }
                }
            }
        });

        // Emit updated game state to all players in the room
        if (this.players.length === 2 && !this.gameOver) {
            io.to(this.id).emit('game-updated', this.getGameState());
        }
    }

    spawnUnit(playerId, unitType, lane) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return false;

        // Define enhanced unit costs and stats
        const unitStats = {
            'Peasant': { 
                cost: 25, 
                health: 60, 
                damage: 5, 
                speed: 1.2, 
                size: 10, 
                attackRange: 45, 
                attackCooldown: 1200 
            },
            'Knight': { 
                cost: 150, 
                health: 250, 
                damage: 20, 
                speed: 1.6, 
                size: 15, 
                attackRange: 50, 
                attackCooldown: 700,
                armorReduction: 0.2 // 20% damage reduction
            },
            'Archer': { 
                cost: 350, 
                health: 85, 
                damage: 10, 
                speed: 2.8, 
                size: 12, 
                attackRange: 180, 
                attackCooldown: 600,
                criticalChance: 0.15 // 15% chance for double damage
            },
            'King': { 
                cost: 500, 
                health: 600, 
                damage: 35, 
                speed: 1.4, 
                size: 20, 
                attackRange: 60, 
                attackCooldown: 500,
                auraRange: 80, // Buff nearby allies
                auraDamageBonus: 0.3 // 30% damage bonus to nearby allies
            },
            'Wizard': { 
                cost: 400, 
                health: 120, 
                damage: 18, 
                speed: 1.5, 
                size: 13, 
                attackRange: 110, 
                attackCooldown: 1500,
                chainLightningRange: 130,
                chainLightningTargets: 4
            }
        };

        const stats = unitStats[unitType];

        if (this.playerResources[playerId] < stats.cost) return false;

        this.playerResources[playerId] -= stats.cost;

        const playerIndex = this.players.findIndex(p => p.id === playerId);

        const CANVAS_HEIGHT = 600;
        const NUM_LANES = 3;
        const laneHeight = CANVAS_HEIGHT / NUM_LANES;
        const laneTop = lane * laneHeight;
        const laneBottom = laneTop + laneHeight;
        const laneCenterY = laneTop + laneHeight / 2;

        // Generate a random offset, but clamp the final y to stay inside the lane
        let y = laneCenterY + (Math.random() - 0.5) * (laneHeight * 0.6);
        y = Math.max(laneTop + 10, Math.min(laneBottom - 10, y)); // 10px padding from lane edge

        const unit = {
            id: `unit_${Date.now()}_${Math.random()}`,
            x: playerIndex === 0 ? 120 : 1080,
            y,
            playerId: playerId,
            health: stats.health,
            maxHealth: stats.health,
            speed: stats.speed,
            damage: stats.damage,
            moving: true,
            unitType: unitType,
            size: stats.size,
            attackRange: stats.attackRange,
            attackCooldown: stats.attackCooldown,
            lastAttackTime: 0,
            lane: lane
        };

        // Add chain lightning properties for Wizard units
        if (unitType === 'Wizard' && stats.chainLightningRange && stats.chainLightningTargets) {
            unit.chainLightningRange = stats.chainLightningRange;
            unit.chainLightningTargets = stats.chainLightningTargets;
        }

        this.units.push(unit);
        return true;
    }

    reset() {
        this.stopGameLoop();
        this.units = [];
        this.traps = [];
        this.turrets = [];
        this.mines = [];
        this.attackAnimations = [];
        this.currentPlayer = 0;
        this.gameOver = false;
        this.winner = null;
        this.lastResourceUpdate = Date.now();

        // Reset resources and bases
        this.players.forEach(player => {
            this.playerResources[player.id] = 500;
            this.playerBases[player.id].health = this.playerBases[player.id].maxHealth;
        });

        if (this.players.length === 2) {
            this.startGameLoop();
        }
    }

    getGameState() {
        return {
            id: this.id,
            players: this.players,
            units: this.units,
            currentPlayer: this.currentPlayer,
            gameOver: this.gameOver,
            winner: this.winner,
            playerResources: this.playerResources,
            playerBases: this.playerBases,
            playerSelectedLane: this.playerSelectedLane,
            attackAnimations: this.attackAnimations,
            traps: this.traps,
            turrets: this.turrets,
            mines: this.mines,
            resourceGenerationRate: this.resourceGenerationRate // <-- add this line
        };
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-game', ({ gameId, playerName }) => {
        if (!games.has(gameId)) {
            games.set(gameId, new Game(gameId));
        }

        const game = games.get(gameId);
        const success = game.addPlayer(socket.id, playerName);

        if (success) {
            socket.join(gameId);
            socket.emit('game-joined', {
                success: true,
                playerIndex: game.players.length - 1,
                game: game.getGameState()
            });

            // Notify all players in the room
            io.to(gameId).emit('game-updated', game.getGameState());
        } else {
            socket.emit('game-joined', { success: false, message: 'Battle is full' });
        }
    });

    socket.on('spawn-unit', ({ gameId, unitType, lane }) => {
        const game = games.get(gameId);
        if (game && game.spawnUnit(socket.id, unitType, lane)) {
            io.to(gameId).emit('game-updated', game.getGameState());
        }
    });

    socket.on('reset-game', ({ gameId }) => {
        const game = games.get(gameId);
        if (game) {
            game.reset();
            io.to(gameId).emit('game-updated', game.getGameState());
        }
    });

    socket.on('select-lane', ({ gameId, lane }) => {
        const game = games.get(gameId);
        if (game && game.playerSelectedLane) {
            game.playerSelectedLane[socket.id] = lane;
            io.to(gameId).emit('game-updated', game.getGameState());
        }
    });

    socket.on('place-trap', ({ gameId, x, y }) => {
        const game = games.get(gameId);
        if (game && game.placeTrap(socket.id, x, y)) {
            io.to(gameId).emit('game-updated', game.getGameState());
        }
    });

    socket.on('place-turret', ({ gameId, x, y }) => {
        const game = games.get(gameId);
        if (game && game.placeTurret(socket.id, x, y)) {
            io.to(gameId).emit('game-updated', game.getGameState());
        }
    });

    socket.on('place-mine', ({ gameId, x, y }) => {
        const game = games.get(gameId);
        if (game && game.placeMine(socket.id, x, y)) {
            io.to(gameId).emit('game-updated', game.getGameState());
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Clean up games when players disconnect
        games.forEach((game, gameId) => {
            const playerIndex = game.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                game.stopGameLoop();
                game.players.splice(playerIndex, 1);
                if (game.players.length === 0) {
                    games.delete(gameId);
                } else {
                    io.to(gameId).emit('player-disconnected', { disconnectedPlayer: playerIndex });
                }
            }
        });
    });
});


const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Game server ready for connections!`);
});