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

class Game {    constructor(id) {
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
        this.playerPowerups = {}; // Track purchased powerups
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
                y: 300, // Center of 600px height canvas (600/2 = 300)
                level: 1,
                weaponType: 'basic',
                damage: 10,
                attackRange: 120
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
            type: 'spike', // Could have different trap types later
            level: 1
        };

        this.traps.push(trap);
        return true;
    }    placeTurret(playerId, x, y) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return false;

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        const TURRET_COST = 200; // Increased cost to place a turret (was 125)
        
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
            type: 'turret',
            level: 1
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
            type: 'mine',
            level: 1
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
                            };                            const reward = unitReward[unit.unitType] || 10;
                            this.playerResources[unit.playerId] = (this.playerResources[unit.playerId] || 0) + reward;
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
                            };                            const reward = unitReward[closest.unitType] || 10;
                            this.playerResources[turret.playerId] = (this.playerResources[turret.playerId] || 0) + reward;
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
    }    startGameLoop() {
        this.gameLoop = setInterval(() => {
            this.updateGame();
        }, 150); // Update every 150ms instead of 100ms for better performance
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
                            };                            const reward = unitReward[target.unitType] || 10;
                            this.playerResources[unit.playerId] = (this.playerResources[unit.playerId] || 0) + reward;
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
        });        // === BASE (TOWER) ATTACK LOGIC ===
        this.players.forEach(player => {
            const base = this.playerBases[player.id];
            if (!base) return;

            // Initialize cooldown tracker if needed
            if (!this.baseAttackCooldowns[player.id]) {
                this.baseAttackCooldowns[player.id] = 0;
            }

            // Use enhanced base attack stats based on weapon type
            const baseAttackRange = base.attackRange || 120;
            const baseAttackDamage = base.damage || 10;
            const baseAttackCooldown = base.attackCooldown || 1200;

            // Find enemy units in range
            const now = Date.now();
            if (now - this.baseAttackCooldowns[player.id] >= baseAttackCooldown) {
                const enemyUnits = this.units.filter(
                    unit =>
                        unit.playerId !== player.id &&
                        Math.abs(unit.x - base.x) <= baseAttackRange &&
                        // Optional: Only attack units in the same vertical area as the base
                        Math.abs(unit.y - 300) < 300 // covers all lanes
                );
                if (enemyUnits.length > 0) {
                    // Attack based on weapon type
                    const weaponType = base.weaponType || 'basic';
                    let targets = [];

                    if (weaponType === 'arrows' && base.multiHit) {
                        // Arrows: Multiple targets
                        const sortedTargets = enemyUnits
                            .sort((a, b) => Math.abs(a.x - base.x) - Math.abs(b.x - base.x))
                            .slice(0, base.hitCount || 3);
                        targets = sortedTargets;
                    } else {
                        // Single target for other weapon types
                        let closest = enemyUnits[0];
                        let minDist = Math.abs(closest.x - base.x);
                        for (const unit of enemyUnits) {
                            const dist = Math.abs(unit.x - base.x);
                            if (dist < minDist) {
                                closest = unit;
                                minDist = dist;
                            }
                        }
                        targets = [closest];
                    }                    // Attack each target
                    targets.forEach((target, index) => {
                        const delay = index * 100; // Stagger attacks for multiple hits
                        setTimeout(() => {
                            // Create weapon-specific attack animation
                            let animationType = 'base';
                            if (weaponType === 'arrows') animationType = 'base_arrows';
                            else if (weaponType === 'trebuchet') animationType = 'base_trebuchet';
                            else if (weaponType === 'wizard') animationType = 'base_lightning';

                            this.createAttackAnimation(base.x, base.y, target.x, target.y, animationType);
                            
                            // Apply damage
                            let damage = baseAttackDamage;
                            if (weaponType === 'trebuchet' && base.aoe) {
                                // AOE damage for trebuchet
                                const aoeRadius = 60;
                                enemyUnits.forEach(nearbyUnit => {
                                    const distance = Math.sqrt(
                                        Math.pow(nearbyUnit.x - target.x, 2) + 
                                        Math.pow(nearbyUnit.y - target.y, 2)
                                    );
                                    if (distance <= aoeRadius) {
                                        nearbyUnit.health = Math.max(0, nearbyUnit.health - damage);
                                    }
                                });
                            } else {
                                target.health = Math.max(0, target.health - damage);
                            }

                            // Handle lightning chain effect for wizard
                            if (weaponType === 'wizard' && base.lightning) {
                                const chainTargets = enemyUnits
                                    .filter(unit => unit.id !== target.id)
                                    .slice(0, 2); // Chain to 2 additional targets
                                
                                chainTargets.forEach((chainTarget, chainIndex) => {
                                    setTimeout(() => {
                                        this.createAttackAnimation(target.x, target.y, chainTarget.x, chainTarget.y, 'base_chain_lightning');
                                        chainTarget.health = Math.max(0, chainTarget.health - Math.floor(damage * 0.7));
                                    }, (chainIndex + 1) * 150);
                                });
                            }
                        }, delay);
                    });

                    this.baseAttackCooldowns[player.id] = now;

                    // Remove dead units after a delay to allow animations
                    setTimeout(() => {
                        this.units = this.units.filter(unit => unit.health > 0);
                    }, 500);
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
        return true;    }

    gamble(playerId) {
        const GAMBLE_COST = 1000;
        const WIN_CHANCE = 1/10000; // 0.0001 or 0.01%
        
        // Check if player has enough resources
        if (this.playerResources[playerId] < GAMBLE_COST) {
            return { success: false, message: 'Not enough resources (1000 required)' };
        }
        
        // Deduct resources
        this.playerResources[playerId] -= GAMBLE_COST;
        
        // Roll the dice
        const roll = Math.random();
        
        if (roll <= WIN_CHANCE) {
            // Player wins the game instantly!
            this.gameOver = true;
            this.winner = this.players.find(p => p.id === playerId);
            this.stopGameLoop();
            return { success: true, won: true, message: 'INCREDIBLE! You won the game!' };
        } else {
            return { success: true, won: false, message: 'Better luck next time!' };
        }
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
    }    resetForRematch() {
        // Stop current game loop
        this.stopGameLoop();
        
        // Reset game state
        this.units = [];
        this.gameOver = false;
        this.winner = null;
        this.currentPlayer = 0;
        this.attackAnimations = [];
        this.traps = [];
        this.turrets = [];
        this.mines = [];
        this.turretAttackCooldowns = {};
        this.baseAttackCooldowns = {};
        
        // Reset player resources and bases
        this.players.forEach(player => {
            this.playerResources[player.id] = 500; // Starting resources
            this.playerBases[player.id] = {
                health: 1000,
                maxHealth: 1000,
                x: this.playerBases[player.id].x, // Keep original position
                y: 300,
                level: 1,
                weaponType: 'basic',
                damage: 10,
                attackRange: 120
            };
            this.playerSelectedLane[player.id] = 0;
        });
        
        // Reset resource generation
        this.resourceGenerationRate = 10;
        this.lastResourceUpdate = Date.now();
        this.lastResourceIncrease = Date.now();
        
        // Reset powerups
        this.playerPowerups = {};
        
        // Start new game loop
        this.startGameLoop();
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
            resourceGenerationRate: this.resourceGenerationRate,
            playerPowerups: this.playerPowerups || {}
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

    socket.on('roulette-bet', ({ gameId, playerId, betAmount }) => {
        const game = games.get(gameId);
        if (game && game.playerResources[playerId] >= betAmount) {
            game.playerResources[playerId] -= betAmount;
            io.to(gameId).emit('game-updated', game.getGameState());
            console.log(`Player ${playerId} placed bet of ${betAmount} coins`);
        }
    });

    socket.on('roulette-win', ({ gameId, playerId, winnings }) => {
        const game = games.get(gameId);
        if (game) {
            game.playerResources[playerId] = (game.playerResources[playerId] || 0) + winnings;
            io.to(gameId).emit('game-updated', game.getGameState());
            console.log(`Player ${playerId} won ${winnings} coins from roulette`);
        }
    });

    socket.on('plinko-reward', ({ gameId, playerId, multiplier, amount }) => {
        const game = games.get(gameId);
        if (game && playerId) {
            if (multiplier < 0) {
                // This is a cost for dropping a ball (deduct the amount)
                game.playerResources[playerId] -= amount;
                console.log(`Player ${playerId} spent ${amount} coins on a Plinko ball`);
            } else {
                // This is a reward for landing in a slot
                const winnings = Math.round(multiplier * amount);
                game.playerResources[playerId] += winnings;
                console.log(`Player ${playerId} won ${winnings} coins from Plinko (${multiplier}x multiplier)`);
            }
            
            // Update the game state
            io.to(gameId).emit('game-updated', game.getGameState());
        }    });

    // Upgrade endpoints
    socket.on('upgrade-castle', ({ gameId }) => {
        const game = games.get(gameId);
        const player = game?.players.find(p => p.id === socket.id);
        
        if (game && player) {
            const playerBase = game.playerBases[player.id];
            const currentLevel = playerBase.level || 1;
            const upgradeCost = currentLevel * 400; // Much more expensive
            const playerResources = game.playerResources[player.id] || 0;
            
            if (currentLevel >= 5) {
                socket.emit('castle-upgraded', { success: false, message: 'Castle is already at maximum level' });
                return;
            }
            
            if (playerResources >= upgradeCost) {
                // Deduct resources
                game.playerResources[player.id] -= upgradeCost;
                
                // Upgrade castle with enhanced benefits
                playerBase.level = currentLevel + 1;
                playerBase.maxHealth += 100; // More health per level
                playerBase.health = playerBase.maxHealth; // Full heal on upgrade
                
                // Recalculate weapon stats based on new level
                const weaponType = playerBase.weaponType || 'basic';
                const baseDamage = 15 + (playerBase.level - 1) * 8;
                const weaponStats = {
                    basic: { damage: 1.0, range: 120, cooldown: 1200 },
                    arrows: { damage: 0.6, range: 140, cooldown: 800 },
                    trebuchet: { damage: 2.2, range: 180, cooldown: 2000 },
                    wizard: { damage: 1.8, range: 160, cooldown: 1500 }
                };
                
                const stats = weaponStats[weaponType];
                playerBase.damage = Math.round(baseDamage * stats.damage);
                playerBase.attackRange = stats.range + (playerBase.level - 1) * 10; // Increased range per level
                
                console.log(`Player ${player.id} upgraded castle to level ${playerBase.level}`);
                socket.emit('castle-upgraded', { success: true });
                io.to(gameId).emit('game-updated', game.getGameState());
            } else {
                socket.emit('castle-upgraded', { success: false, message: 'Not enough resources' });
            }        }
    });

    socket.on('change-castle-weapon', ({ gameId, weaponType }) => {
        const game = games.get(gameId);
        const player = game?.players.find(p => p.id === socket.id);
        
        if (game && player) {
            const playerBase = game.playerBases[player.id];
            const currentLevel = playerBase.level || 1;
            const playerResources = game.playerResources[player.id] || 0;
            
            // Check if weapon is unlocked and player has enough resources
            const weaponRequirements = {
                basic: 1,
                arrows: 2,
                trebuchet: 3,
                wizard: 4
            };

            // Enhanced weapon costs and switching fees
            const weaponSwitchCosts = {
                basic: 0,      // Free weapon
                arrows: 150,   // Cost to switch to or first purchase
                trebuchet: 300,
                wizard: 500
            };

            const weaponStats = {
                basic: { damage: 1.0, range: 120, cooldown: 1200, multiHit: false },
                arrows: { damage: 0.6, range: 140, cooldown: 800, multiHit: true, hitCount: 3 },
                trebuchet: { damage: 2.2, range: 180, cooldown: 2000, multiHit: false, aoe: true },
                wizard: { damage: 1.8, range: 160, cooldown: 1500, multiHit: false, lightning: true }
            };
            
            const switchCost = weaponSwitchCosts[weaponType];
            const isCurrentWeapon = playerBase.weaponType === weaponType;
            
            if (currentLevel >= weaponRequirements[weaponType] && playerResources >= switchCost && !isCurrentWeapon) {
                // Deduct switching cost
                game.playerResources[player.id] -= switchCost;
                
                // Set weapon type
                playerBase.weaponType = weaponType;
                
                // Apply weapon stats
                const baseDamage = 15 + (currentLevel - 1) * 8; // Increased base damage
                const stats = weaponStats[weaponType];
                
                playerBase.damage = Math.round(baseDamage * stats.damage);
                playerBase.attackRange = stats.range;
                playerBase.attackCooldown = stats.cooldown;
                playerBase.multiHit = stats.multiHit || false;
                playerBase.hitCount = stats.hitCount || 1;
                playerBase.aoe = stats.aoe || false;
                playerBase.lightning = stats.lightning || false;
                
                console.log(`Player ${player.id} changed castle weapon to ${weaponType} for ${switchCost} resources`);
                socket.emit('weapon-changed', { success: true });
                io.to(gameId).emit('game-updated', game.getGameState());
            } else {
                const reason = currentLevel < weaponRequirements[weaponType] ? 'Weapon not unlocked' :
                              isCurrentWeapon ? 'Already using this weapon' :
                              'Not enough resources';
                socket.emit('weapon-changed', { success: false, message: reason });            }
        }
    });

    socket.on('upgrade-turret', ({ gameId, turretId }) => {
        const game = games.get(gameId);
        const player = game?.players.find(p => p.id === socket.id);
        
        if (game && player) {
            const turret = game.turrets.find(t => t.id === turretId && t.playerId === player.id);
            const currentLevel = turret ? (turret.level || 1) : 1;
            const upgradeCost = 150 * currentLevel; // Much more expensive, scales with level
            const playerResources = game.playerResources[player.id] || 0;
            
            if (turret && playerResources >= upgradeCost && currentLevel < 5) {
                // Deduct resources
                game.playerResources[player.id] -= upgradeCost;
                
                // Upgrade turret with more significant improvements
                turret.level = currentLevel + 1;
                turret.damage = Math.round(turret.damage * 1.8); // Bigger damage increase
                turret.attackRange = Math.round(turret.attackRange * 1.3); // Better range increase
                turret.maxHealth = Math.round(turret.maxHealth * 1.5); // More health
                turret.health = turret.maxHealth; // Full heal on upgrade
                turret.attackCooldown = Math.max(300, turret.attackCooldown * 0.85); // Faster attacks
                
                console.log(`Player ${player.id} upgraded turret ${turretId} to level ${turret.level}`);
                socket.emit('turret-upgraded', { success: true });
                io.to(gameId).emit('game-updated', game.getGameState());
            } else {
                const reason = !turret ? 'Turret not found' : 
                             currentLevel >= 5 ? 'Maximum level reached' : 
                             'Not enough resources';                socket.emit('turret-upgraded', { success: false, message: reason });
            }
        }
    });

    socket.on('upgrade-trap', ({ gameId, trapId }) => {
        const game = games.get(gameId);
        const player = game?.players.find(p => p.id === socket.id);
        
        if (game && player) {
            const trap = game.traps.find(t => t.id === trapId && t.playerId === player.id);
            const currentLevel = trap ? (trap.level || 1) : 1;
            const upgradeCost = 100 * currentLevel; // More expensive and scaling
            const playerResources = game.playerResources[player.id] || 0;
            
            if (trap && playerResources >= upgradeCost && currentLevel < 3) {
                // Deduct resources
                game.playerResources[player.id] -= upgradeCost;
                
                // Upgrade trap with significant improvements
                trap.damage = Math.round(trap.damage * 1.8);
                trap.level = currentLevel + 1;
                
                console.log(`Player ${player.id} upgraded trap ${trapId} to level ${trap.level}`);
                socket.emit('trap-upgraded', { success: true });
                io.to(gameId).emit('game-updated', game.getGameState());
            } else {
                const reason = !trap ? 'Trap not found' : 
                             currentLevel >= 3 ? 'Maximum level reached' : 
                             'Not enough resources';
                socket.emit('trap-upgraded', { success: false, message: reason });
            }
        }
    });

    socket.on('upgrade-mine', ({ gameId, mineId }) => {
        const game = games.get(gameId);
        const player = game?.players.find(p => p.id === socket.id);
        
        if (game && player) {
            const mine = game.mines.find(m => m.id === mineId && m.playerId === player.id);
            const currentLevel = mine ? (mine.level || 1) : 1;
            const upgradeCost = 125 * currentLevel; // More expensive and scaling
            const playerResources = game.playerResources[player.id] || 0;
            
            if (mine && playerResources >= upgradeCost && currentLevel < 3) {
                // Deduct resources
                game.playerResources[player.id] -= upgradeCost;
                
                // Upgrade mine with significant improvements
                mine.damage = Math.round(mine.damage * 1.6);
                mine.explosionRadius = Math.round(mine.explosionRadius * 1.3);
                mine.level = currentLevel + 1;
                
                console.log(`Player ${player.id} upgraded mine ${mineId} to level ${mine.level}`);
                socket.emit('mine-upgraded', { success: true });
                io.to(gameId).emit('game-updated', game.getGameState());
            } else {
                const reason = !mine ? 'Mine not found' : 
                             currentLevel >= 3 ? 'Maximum level reached' : 
                             'Not enough resources';
                socket.emit('mine-upgraded', { success: false, message: reason });
            }
        }    });

    socket.on('purchase-powerup', ({ gameId, unitType, powerupName, cost }) => {
        const game = games.get(gameId);
        const player = game?.players.find(p => p.id === socket.id);
        
        if (game && player) {
            const playerResources = game.playerResources[player.id] || 0;
            
            // Initialize powerups structure if it doesn't exist
            if (!game.playerPowerups) {
                game.playerPowerups = {};
            }
            if (!game.playerPowerups[player.id]) {
                game.playerPowerups[player.id] = {};
            }
            if (!game.playerPowerups[player.id][unitType]) {
                game.playerPowerups[player.id][unitType] = {};
            }
            
            // Check if powerup is already purchased
            const isAlreadyPurchased = game.playerPowerups[player.id][unitType][powerupName];
            
            if (!isAlreadyPurchased && playerResources >= cost) {
                // Deduct resources
                game.playerResources[player.id] -= cost;
                
                // Mark powerup as purchased
                game.playerPowerups[player.id][unitType][powerupName] = true;
                
                console.log(`Player ${player.id} purchased ${powerupName} for ${unitType} (${cost} resources)`);
                socket.emit('powerup-purchased', { success: true });
                io.to(gameId).emit('game-updated', game.getGameState());
            } else {
                const reason = isAlreadyPurchased ? 'Already purchased' : 'Not enough resources';
                socket.emit('powerup-purchased', { success: false, message: reason });
            }
        }    });    socket.on('gamble', ({ gameId }) => {
        const game = games.get(gameId);
        const player = game?.players.find(p => p.id === socket.id);
        
        if (game && player) {
            const result = game.gamble(player.id);
            socket.emit('gamble-result', result);
            
            // Send updated game state
            io.to(gameId).emit('game-update', game.getGameState());
            
            // If they won, emit special celebration
            if (result.won) {
                io.to(gameId).emit('gamble-victory', { 
                    winner: player.name,
                    message: result.message 
                });
            }
        }
    });

    socket.on('request-rematch', ({ gameId }) => {
        const game = games.get(gameId);
        if (!game) return;

        const playerId = socket.id;
        const player = game.players.find(p => p.id === playerId);
        if (!player) return;

        // Initialize rematch requests if not exists
        if (!game.rematchRequests) {
            game.rematchRequests = new Set();
        }

        // Add this player's rematch request
        game.rematchRequests.add(playerId);

        // Notify all players about the rematch request
        const requesterName = player.name;
        io.to(gameId).emit('rematch-requested', { 
            requester: requesterName,
            playerId: playerId 
        });

        // Check if both players have requested rematch
        if (game.rematchRequests.size === 2) {
            // Reset the game state for rematch
            game.resetForRematch();
            
            // Clear rematch requests
            game.rematchRequests.clear();
            
            // Notify players that rematch is starting
            io.to(gameId).emit('rematch-started');
            
            // Send updated game state
            io.to(gameId).emit('game-update', game.getGameState());
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
                } else {                    io.to(gameId).emit('player-disconnected', { disconnectedPlayer: playerIndex });
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