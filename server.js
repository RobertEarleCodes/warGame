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
        this.playerSelectedLane = {};
        this.playerBases = {};
        this.lastResourceUpdate = Date.now();
        this.gameLoop = null;
        this.baseAttackCooldowns = {};
        this.attackAnimations = [];
        this.traps = [];
        this.turrets = [];
        this.mines = [];        this.turretAttackCooldowns = {};
        this.resourceGenerationRate = 10;
        this.resourceGenerationIncreaseInterval = 20000;
        this.lastResourceIncrease = Date.now();
        this.playerPowerups = {}; // Track powerups for each player
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
            };            this.players.push(player);
            this.playerResources[playerId] = 500; // Starting resources
            this.playerBases[playerId] = {
                health: 1000,
                maxHealth: 1000,
                x: basePositions[this.players.length - 1],
                y: 300, // Center of 600px height canvas (600/2 = 300)
                level: 1,
                weaponType: 'basic',
                damage: 15,
                attackRange: 120,
                attackCooldown: 1200,
                lastAttackTime: 0,
                unlockedWeapons: ['basic']            };
            this.playerSelectedLane[playerId] = 0; // Default lane
            this.initializePowerups(playerId); // Initialize powerups for the player

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
                    const baseUnitReward = {
                        'Peasant': 15,
                        'Knight': 50,
                        'Archer': 100,
                        'King': 200,
                        'Wizard': 150
                    };
                    const reward = Math.floor((baseUnitReward[target.unitType] || 15) * 0.5); // Half reward for chain kills
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
            level: 1,
            triggered: false,
            type: 'spike' // Could have different trap types later
        };

        this.traps.push(trap);
        return true;
    }

    placeTurret(playerId, x, y, turretType = 'basic') {
        const turretCosts = {
            basic: 50,
            trebuchet: 100,
            wizard: 150
        };

        const cost = turretCosts[turretType] || 50;
        
        if (this.playerResources[playerId] >= cost) {
            const turretId = `turret_${Date.now()}_${Math.random()}`;
            
            const turretStats = this.getTurretStats(turretType, 1);
            
            const turret = {
                id: turretId,
                x: x,
                y: y,
                playerId: playerId,
                health: turretStats.health,
                maxHealth: turretStats.maxHealth,
                damage: turretStats.damage,
                attackRange: turretStats.attackRange,
                attackCooldown: turretStats.attackCooldown,
                lastAttackTime: 0,
                type: 'turret',
                level: 1,
                turretType: turretType,
                splashRadius: turretStats.splashRadius,
                chainLightningRange: turretStats.chainLightningRange,
                chainLightningTargets: turretStats.chainLightningTargets
            };
            
            this.turrets.push(turret);
            this.playerResources[playerId] -= cost;
            return true;
        }
        return false;
    }

    getTurretStats(turretType, level) {
        const baseStats = {
            basic: {
                health: 100,
                maxHealth: 100,
                damage: 25,
                attackRange: 150,
                attackCooldown: 1000
            },
            trebuchet: {
                health: 150,
                maxHealth: 150,
                damage: 60,
                attackRange: 200,
                attackCooldown: 2000,
                splashRadius: 80
            },
            wizard: {
                health: 80,
                maxHealth: 80,
                damage: 40,
                attackRange: 180,
                attackCooldown: 1500,
                chainLightningRange: 100,
                chainLightningTargets: 3
            }
        };

        const stats = { ...baseStats[turretType] };
        
        // Scale stats with level
        const multiplier = 1 + (level - 1) * 0.3; // 30% increase per level
        stats.health = Math.floor(stats.health * multiplier);
        stats.maxHealth = Math.floor(stats.maxHealth * multiplier);
        stats.damage = Math.floor(stats.damage * multiplier);
        stats.attackRange = Math.floor(stats.attackRange * (1 + (level - 1) * 0.1)); // 10% range increase per level

        return stats;
    }

    upgradeTurret(playerId, turretId) {
        const turret = this.turrets.find(t => t.id === turretId && t.playerId === playerId);
        if (!turret) return false;

        const upgradeCost = 30 * turret.level; // Cost increases with level
        
        if (this.playerResources[playerId] >= upgradeCost && turret.level < 5) {
            turret.level++;
            const newStats = this.getTurretStats(turret.turretType, turret.level);
            
            // Update turret stats
            turret.maxHealth = newStats.maxHealth;
            turret.health = newStats.maxHealth; // Full heal on upgrade
            turret.damage = newStats.damage;
            turret.attackRange = newStats.attackRange;
            turret.splashRadius = newStats.splashRadius;
            turret.chainLightningRange = newStats.chainLightningRange;
            turret.chainLightningTargets = newStats.chainLightningTargets;
            
            this.playerResources[playerId] -= upgradeCost;
            return true;        }
        return false;
    }

    upgradeCastle(playerId) {
        const castle = this.playerBases[playerId];
        if (!castle) return false;

        const upgradeCosts = [0, 200, 400, 800, 1600]; // Costs for levels 1->2, 2->3, etc.
        const currentLevel = castle.level || 1;
        
        if (currentLevel >= 5) return false; // Max level
        
        const upgradeCost = upgradeCosts[currentLevel - 1] || 200;
        
        if (this.playerResources[playerId] >= upgradeCost) {
            castle.level = currentLevel + 1;
            
            // Update castle stats based on level
            const levelMultiplier = 1 + (castle.level - 1) * 0.4; // 40% increase per level
            castle.maxHealth = Math.floor(1000 * levelMultiplier);
            castle.health = castle.maxHealth; // Full heal on upgrade
            castle.damage = Math.floor(15 * levelMultiplier);
            castle.attackRange = Math.floor(120 * (1 + (castle.level - 1) * 0.15)); // 15% range increase per level
            
            // Unlock new weapons at certain levels
            if (castle.level >= 2 && !castle.unlockedWeapons.includes('arrows')) {
                castle.unlockedWeapons.push('arrows');
            }
            if (castle.level >= 3 && !castle.unlockedWeapons.includes('trebuchet')) {
                castle.unlockedWeapons.push('trebuchet');
            }
            if (castle.level >= 4 && !castle.unlockedWeapons.includes('wizard')) {
                castle.unlockedWeapons.push('wizard');
            }
            
            this.playerResources[playerId] -= upgradeCost;
            return true;
        }
        return false;
    }

    changeCastleWeapon(playerId, weaponType) {
        const castle = this.playerBases[playerId];
        if (!castle) return false;

        // Check if weapon is unlocked
        if (!castle.unlockedWeapons.includes(weaponType)) return false;

        const weaponCosts = {
            basic: 0,
            arrows: 50,
            trebuchet: 100,
            wizard: 150
        };

        const cost = weaponCosts[weaponType] || 0;
        
        if (this.playerResources[playerId] >= cost) {
            castle.weaponType = weaponType;
            
            // Update weapon-specific stats
            const baseStats = this.getCastleWeaponStats(weaponType, castle.level);
            castle.damage = baseStats.damage;
            castle.attackRange = baseStats.attackRange;
            castle.attackCooldown = baseStats.attackCooldown;
            
            this.playerResources[playerId] -= cost;
            return true;
        }
        return false;
    }

    getCastleWeaponStats(weaponType, level) {
        const baseStats = {
            basic: {
                damage: 15,
                attackRange: 120,
                attackCooldown: 1200
            },
            arrows: {
                damage: 12,
                attackRange: 180,
                attackCooldown: 800
            },
            trebuchet: {
                damage: 35,
                attackRange: 200,
                attackCooldown: 2500,
                splashRadius: 60
            },
            wizard: {
                damage: 25,
                attackRange: 160,
                attackCooldown: 1800,
                chainLightningRange: 80,
                chainLightningTargets: 2
            }
        };

        const stats = { ...baseStats[weaponType] };
        
        // Scale with level
        const multiplier = 1 + (level - 1) * 0.4;
        stats.damage = Math.floor(stats.damage * multiplier);        stats.attackRange = Math.floor(stats.attackRange * (1 + (level - 1) * 0.15));
          return stats;
    }

    // Powerups system
    initializePowerups(playerId) {
        this.playerPowerups[playerId] = {
            peasant: {
                enhancedTools: false,
                hardyWorkers: false
            },
            knight: {
                masterArmor: false,
                battleCharge: false
            },
            archer: {
                eagleEye: false,
                piercingShots: false
            },
            king: {
                royalAuthority: false,
                divineProtection: false
            },
            wizard: {
                arcLightning: false,
                manaShield: false
            }
        };
    }

    purchasePowerup(playerId, unitType, powerupName) {
        if (!this.playerPowerups[playerId]) {
            this.initializePowerups(playerId);
        }

        const powerupCosts = {
            peasant: {
                enhancedTools: 150,
                hardyWorkers: 200
            },
            knight: {
                masterArmor: 300,
                battleCharge: 400
            },
            archer: {
                eagleEye: 350,
                piercingShots: 450
            },
            king: {
                royalAuthority: 500,
                divineProtection: 600
            },
            wizard: {
                arcLightning: 400,
                manaShield: 550
            }
        };        const cost = powerupCosts[unitType]?.[powerupName];
        if (!cost) return false;

        // Check if powerup is already purchased
        if (this.playerPowerups[playerId][unitType][powerupName]) return false;

        // Check if player has enough resources
        if (this.playerResources[playerId] < cost) return false;

        // Purchase powerup
        this.playerResources[playerId] -= cost;
        this.playerPowerups[playerId][unitType][powerupName] = true;
        
        return true;
    }

    getPowerupModifiers(playerId, unitType) {
        if (!this.playerPowerups[playerId]) {
            this.initializePowerups(playerId);
        }

        const powerups = this.playerPowerups[playerId];
        let modifiers = {
            damage: 1,
            health: 1,
            speed: 1,
            armorReduction: 0,
            criticalChance: 0,
            chainLightningTargets: 0,
            chainLightningRange: 0,
            auraRange: 1,
            auraDamageBonus: 0,
            healthRegen: false,
            immuneToCrits: false,
            damageReflection: 0,
            piercing: false
        };

        switch(unitType.toLowerCase()) {
            case 'peasant':
                if (powerups.peasant.enhancedTools) {
                    modifiers.damage *= 1.5;
                    modifiers.speed *= 1.25;
                }
                if (powerups.peasant.hardyWorkers) {
                    modifiers.health *= 2;
                }
                break;
            
            case 'knight':
                if (powerups.knight.masterArmor) {
                    modifiers.armorReduction = 0.35; // Increased from 20% to 35%
                }
                if (powerups.knight.battleCharge) {
                    // This will be applied conditionally when health < 50%
                }
                break;
            
            case 'archer':
                if (powerups.archer.eagleEye) {
                    modifiers.criticalChance = 0.25; // Increased from 15% to 25%
                }
                if (powerups.archer.piercingShots) {
                    modifiers.piercing = true;
                }
                break;
            
            case 'king':
                if (powerups.king.royalAuthority) {
                    modifiers.auraRange = 1.5;
                    modifiers.auraDamageBonus = 0.5; // Increased from 30% to 50%
                }
                if (powerups.king.divineProtection) {
                    modifiers.immuneToCrits = true;
                    modifiers.healthRegen = true;
                }
                break;
            
            case 'wizard':
                if (powerups.wizard.arcLightning) {
                    modifiers.chainLightningTargets = 2; // +2 additional targets
                    modifiers.chainLightningRange = 1.5; // +50% range
                }
                if (powerups.wizard.manaShield) {
                    modifiers.armorReduction = 0.4; // 40% damage reduction
                    modifiers.damageReflection = 0.25; // 25% reflection
                }
                break;
        }

        return modifiers;
    }

    processCastleTrebuchetAttack(castle, target, attackTime) {
        // Create boulder animation
        this.createAttackAnimation(castle.x, castle.y, target.x, target.y, 'castle_boulder');
        
        // Splash damage
        const weaponStats = this.getCastleWeaponStats(castle.weaponType, castle.level);
        const splashRadius = weaponStats.splashRadius || 60;
        
        const affectedUnits = this.units.filter(unit => {
            if (unit.playerId === castle.playerId) return false;
            const distance = Math.sqrt(
                Math.pow(unit.x - target.x, 2) + Math.pow(unit.y - target.y, 2)
            );
            return distance <= splashRadius;
        });
        
        affectedUnits.forEach(unit => {
            const distance = Math.sqrt(
                Math.pow(unit.x - target.x, 2) + Math.pow(unit.y - target.y, 2)
            );
            const damageMultiplier = 1 - (distance / splashRadius) * 0.5;
            unit.health -= Math.floor(castle.damage * damageMultiplier);
        });
    }

    processCastleWizardAttack(castle, primaryTarget, attackTime) {
        // Create lightning animation
        this.createAttackAnimation(castle.x, castle.y, primaryTarget.x, primaryTarget.y, 'castle_lightning');
        
        // Primary target takes full damage
        primaryTarget.health -= castle.damage;
        
        // Chain lightning to nearby enemies
        const weaponStats = this.getCastleWeaponStats(castle.weaponType, castle.level);
        const chainRange = weaponStats.chainLightningRange || 80;
        const chainTargets = weaponStats.chainLightningTargets || 2;
        
        const hitTargets = [primaryTarget];
        let currentTarget = primaryTarget;
        
        for (let i = 0; i < chainTargets - 1; i++) {
            const nearbyEnemies = this.units.filter(unit => {
                if (unit.playerId === castle.playerId) return false;
                if (hitTargets.includes(unit)) return false;
                
                const distance = Math.sqrt(
                    Math.pow(unit.x - currentTarget.x, 2) + Math.pow(unit.y - currentTarget.y, 2)
                );
                return distance <= chainRange;
            });
            
            if (nearbyEnemies.length === 0) break;
            
            const nextTarget = nearbyEnemies.reduce((closest, unit) => {
                const distToUnit = Math.sqrt(
                    Math.pow(unit.x - currentTarget.x, 2) + Math.pow(unit.y - currentTarget.y, 2)
                );
                const distToClosest = Math.sqrt(
                    Math.pow(closest.x - currentTarget.x, 2) + Math.pow(closest.y - currentTarget.y, 2)
                );
                return distToUnit < distToClosest ? unit : closest;
            });
            
            const chainDamage = Math.floor(castle.damage * Math.pow(0.8, i + 1));
            nextTarget.health -= chainDamage;
            
            this.createAttackAnimation(currentTarget.x, currentTarget.y, nextTarget.x, nextTarget.y, 'castle_chain_lightning');
            
            hitTargets.push(nextTarget);
            currentTarget = nextTarget;
        }
    }

    updateTurretAttacks() {
        const currentTime = Date.now();
        
        this.turrets.forEach(turret => {
            if (currentTime - turret.lastAttackTime < turret.attackCooldown) return;
            
            // Find enemy units within range
            const enemies = this.units.filter(unit => {
                if (unit.playerId === turret.playerId) return false;
                const distance = Math.sqrt(
                    Math.pow(unit.x - turret.x, 2) + Math.pow(unit.y - turret.y, 2)
                );
                return distance <= turret.attackRange;
            });
            
            if (enemies.length > 0) {
                const target = enemies[0]; // Attack closest enemy
                
                if (turret.turretType === 'trebuchet') {
                    this.processTrebuchetAttack(turret, target, currentTime);
                } else if (turret.turretType === 'wizard') {
                    this.processWizardAttack(turret, target, currentTime);
                } else {
                    // Basic turret attack
                    target.health -= turret.damage;
                    this.createAttackAnimation(turret.x, turret.y, target.x, target.y, 'projectile');
                }
                
                turret.lastAttackTime = currentTime;
            }
        });
        
        // Remove dead units
        this.units = this.units.filter(unit => unit.health > 0);
    }

    processTrebuchetAttack(turret, target, attackTime) {
        // Create projectile animation
        this.createAttackAnimation(turret.x, turret.y, target.x, target.y, 'boulder');
        
        // Splash damage
        const affectedUnits = this.units.filter(unit => {
            if (unit.playerId === turret.playerId) return false;
            const distance = Math.sqrt(
                Math.pow(unit.x - target.x, 2) + Math.pow(unit.y - target.y, 2)
            );
            return distance <= turret.splashRadius;
        });
        
        affectedUnits.forEach(unit => {
            const distance = Math.sqrt(
                Math.pow(unit.x - target.x, 2) + Math.pow(unit.y - target.y, 2)
            );
            const damageMultiplier = 1 - (distance / turret.splashRadius) * 0.5; // Damage falls off with distance
            unit.health -= Math.floor(turret.damage * damageMultiplier);
        });
    }

    processWizardAttack(turret, primaryTarget, attackTime) {
        // Create lightning animation
        this.createAttackAnimation(turret.x, turret.y, primaryTarget.x, primaryTarget.y, 'lightning');
        
        // Primary target takes full damage
        primaryTarget.health -= turret.damage;
        
        // Chain lightning to nearby enemies
        const hitTargets = [primaryTarget];
        let currentTarget = primaryTarget;
        
        for (let i = 0; i < turret.chainLightningTargets - 1; i++) {
            const nearbyEnemies = this.units.filter(unit => {
                if (unit.playerId === turret.playerId) return false;
                if (hitTargets.includes(unit)) return false;
                
                const distance = Math.sqrt(
                    Math.pow(unit.x - currentTarget.x, 2) + Math.pow(unit.y - currentTarget.y, 2)
                );
                return distance <= turret.chainLightningRange;
            });
            
            if (nearbyEnemies.length === 0) break;
            
            // Find closest enemy
            const nextTarget = nearbyEnemies.reduce((closest, unit) => {
                const distToUnit = Math.sqrt(
                    Math.pow(unit.x - currentTarget.x, 2) + Math.pow(unit.y - currentTarget.y, 2)
                );
                const distToClosest = Math.sqrt(
                    Math.pow(closest.x - currentTarget.x, 2) + Math.pow(closest.y - currentTarget.y, 2)
                );
                return distToUnit < distToClosest ? unit : closest;
            });
            
            // Chain damage reduces by 20% each jump
            const chainDamage = Math.floor(turret.damage * Math.pow(0.8, i + 1));
            nextTarget.health -= chainDamage;
            
            // Create chain lightning animation
            this.createAttackAnimation(currentTarget.x, currentTarget.y, nextTarget.x, nextTarget.y, 'chain_lightning');
            
            hitTargets.push(nextTarget);
            currentTarget = nextTarget;
        }
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
            level: 1,
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
        const currentTime = Date.now();
        
        this.turrets.forEach(turret => {
            if (currentTime - turret.lastAttackTime < turret.attackCooldown) return;
            
            // Find enemy units within range
            const enemies = this.units.filter(unit => {
                if (unit.playerId === turret.playerId) return false;
                const distance = Math.sqrt(
                    Math.pow(unit.x - turret.x, 2) + Math.pow(unit.y - turret.y, 2)
                );
                return distance <= turret.attackRange;
            });
            
            if (enemies.length > 0) {
                const target = enemies[0]; // Attack closest enemy
                
                if (turret.turretType === 'trebuchet') {
                    this.processTrebuchetAttack(turret, target, currentTime);
                } else if (turret.turretType === 'wizard') {
                    this.processWizardAttack(turret, target, currentTime);
                } else {
                    // Basic turret attack
                    target.health -= turret.damage;
                    this.createAttackAnimation(turret.x, turret.y, target.x, target.y, 'projectile');
                }
                
                turret.lastAttackTime = currentTime;
            }
        });
        
        // Remove dead units
        this.units = this.units.filter(unit => unit.health > 0);
    }

    processTrebuchetAttack(turret, target, attackTime) {
        // Create projectile animation
        this.createAttackAnimation(turret.x, turret.y, target.x, target.y, 'boulder');
        
        // Splash damage
        const affectedUnits = this.units.filter(unit => {
            if (unit.playerId === turret.playerId) return false;
            const distance = Math.sqrt(
                Math.pow(unit.x - target.x, 2) + Math.pow(unit.y - target.y, 2)
            );
            return distance <= turret.splashRadius;
        });
        
        affectedUnits.forEach(unit => {
            const distance = Math.sqrt(
                Math.pow(unit.x - target.x, 2) + Math.pow(unit.y - target.y, 2)
            );
            const damageMultiplier = 1 - (distance / turret.splashRadius) * 0.5; // Damage falls off with distance
            unit.health -= Math.floor(turret.damage * damageMultiplier);
        });
    }

    processWizardAttack(turret, primaryTarget, attackTime) {
        // Create lightning animation
        this.createAttackAnimation(turret.x, turret.y, primaryTarget.x, primaryTarget.y, 'lightning');
        
        // Primary target takes full damage
        primaryTarget.health -= turret.damage;
        
        // Chain lightning to nearby enemies
        const hitTargets = [primaryTarget];
        let currentTarget = primaryTarget;
        
        for (let i = 0; i < turret.chainLightningTargets - 1; i++) {
            const nearbyEnemies = this.units.filter(unit => {
                if (unit.playerId === turret.playerId) return false;
                if (hitTargets.includes(unit)) return false;
                
                const distance = Math.sqrt(
                    Math.pow(unit.x - currentTarget.x, 2) + Math.pow(unit.y - currentTarget.y, 2)
                );
                return distance <= turret.chainLightningRange;
            });
            
            if (nearbyEnemies.length === 0) break;
            
            // Find closest enemy
            const nextTarget = nearbyEnemies.reduce((closest, unit) => {
                const distToUnit = Math.sqrt(
                    Math.pow(unit.x - currentTarget.x, 2) + Math.pow(unit.y - currentTarget.y, 2)
                );
                const distToClosest = Math.sqrt(
                    Math.pow(closest.x - currentTarget.x, 2) + Math.pow(closest.y - currentTarget.y, 2)
                );
                return distToUnit < distToClosest ? unit : closest;
            });
            
            // Chain damage reduces by 20% each jump
            const chainDamage = Math.floor(turret.damage * Math.pow(0.8, i + 1));
            nextTarget.health -= chainDamage;
            
            // Create chain lightning animation
            this.createAttackAnimation(currentTarget.x, currentTarget.y, nextTarget.x, nextTarget.y, 'chain_lightning');
            
            hitTargets.push(nextTarget);
            currentTarget = nextTarget;
        }
    }

    upgradeTrap(playerId, trapId) {
        const trap = this.traps.find(t => t.id === trapId && t.playerId === playerId);
        if (!trap) return false;

        const upgradeCost = 20 * trap.level; // Cost increases with level
        
        if (this.playerResources[playerId] >= upgradeCost && trap.level < 5) {
            trap.level++;
            // Increase damage by 15 per level
            trap.damage = 30 + (trap.level - 1) * 15;
            
            this.playerResources[playerId] -= upgradeCost;
            return true;
        }
        return false;
    }

    upgradeMine(playerId, mineId) {
        const mine = this.mines.find(m => m.id === mineId && m.playerId === playerId);
        if (!mine) return false;

        const upgradeCost = 25 * mine.level; // Cost increases with level
        
        if (this.playerResources[playerId] >= upgradeCost && mine.level < 5) {
            mine.level++;
            // Increase damage and explosion radius per level
            mine.damage = 50 + (mine.level - 1) * 20;
            mine.explosionRadius = 45 + (mine.level - 1) * 10;
            
            this.playerResources[playerId] -= upgradeCost;
            return true;
        }
        return false;
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
        this.updateTurretAttacks();        // === Increase resource generation rate by 0.1 every 10 seconds (much slower) ===
        const now = Date.now();
        if (now - this.lastResourceIncrease > 10000) { // Every 10 seconds
            this.resourceGenerationRate += 0.1; // Much slower increase
            this.lastResourceIncrease = now;
        }

        // === Generate resources over time ===
        if (now - this.lastResourceUpdate > 1000) { // Every second
            this.players.forEach(player => {
                let playerGenerationRate = this.resourceGenerationRate;
                
                // Bonus production based on units
                const playerUnits = this.units.filter(u => u.playerId === player.id);
                const peasantCount = playerUnits.filter(u => u.unitType === 'Peasant').length;
                
                // Hardy Workers powerup: +10% resource generation per Peasant
                if (this.playerPowerups[player.id]?.peasant?.hardyWorkers) {
                    playerGenerationRate += peasantCount * (this.resourceGenerationRate * 0.1);
                }
                
                // Base bonus for having units
                playerGenerationRate += playerUnits.length * 0.5;
                
                this.playerResources[player.id] =
                    (this.playerResources[player.id] || 0) + Math.floor(playerGenerationRate);
            });
            this.lastResourceUpdate = now;
        }// Move units and handle combat
        this.units.forEach((unit, index) => {
            const player = this.players.find(p => p.id === unit.playerId);
            const enemyPlayer = this.players.find(p => p.id !== unit.playerId);
            if (!player || !enemyPlayer) return;

            // Health regeneration for units with the powerup
            if (unit.healthRegen && unit.health < unit.maxHealth) {
                unit.health = Math.min(unit.maxHealth, unit.health + 1); // Regenerate 1 HP per update
            }

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

            if (target === 'base') {                // Attack enemy base (with cooldown)
                const now = Date.now();
                if (now - unit.lastAttackTime >= unit.attackCooldown) {
                    const enemyBase = this.playerBases[enemyPlayer.id];
                    
                    // Create attack animation based on unit type
                    let animationType = 'melee';
                    if (unit.unitType === 'Archer') {
                        animationType = 'archer_arrow';
                    } else if (unit.attackRange > 100) {
                        animationType = 'projectile';
                    }
                    
                    this.createAttackAnimation(unit.x, unit.y, enemyBase.x, enemyBase.y, animationType);
                    
                    enemyBase.health = Math.max(0, enemyBase.health - unit.damage);
                    unit.lastAttackTime = now;

                    if (enemyBase.health <= 0) {
                        this.gameOver = true;
                        this.winner = player;
                        this.stopGameLoop();
                    }
                }
            } else if (target) {                // Attack enemy unit (with cooldown)
                const now = Date.now();
                if (now - unit.lastAttackTime >= unit.attackCooldown) {
                    // Create attack animation based on unit type
                    let animationType = 'melee';
                    if (unit.unitType === 'Archer') {
                        animationType = 'archer_arrow';
                    } else if (unit.attackRange > 100) {
                        animationType = 'projectile';
                    }
                    
                    this.createAttackAnimation(unit.x, unit.y, target.x, target.y, animationType);
                      // Calculate enhanced damage with special abilities and powerups
                    let finalDamage = unit.damage;
                    
                    // King Aura Bonus: Increase damage if near friendly King
                    const nearbyKings = this.units.filter(ally => 
                        ally.playerId === unit.playerId && 
                        ally.unitType === 'King' && 
                        ally.id !== unit.id &&
                        Math.sqrt(Math.pow(ally.x - unit.x, 2) + Math.pow(ally.y - unit.y, 2)) <= (unit.auraRange || 80)
                    );
                    if (nearbyKings.length > 0) {
                        const auraBonus = nearbyKings[0].auraDamageBonus || 0.3;
                        finalDamage *= (1 + auraBonus); // Apply aura bonus
                        // Create aura effect animation
                        this.createAttackAnimation(unit.x, unit.y, unit.x, unit.y, 'aura_boost');
                    }
                    
                    // Critical Hit system (Archers and powerup-enhanced units)
                    const critChance = unit.criticalChance || 0;
                    if (critChance > 0 && Math.random() < critChance && !target.immuneToCrits) {
                        finalDamage *= 2;
                        // Create critical hit animation
                        this.createAttackAnimation(unit.x, unit.y, target.x, target.y, 'critical_hit');
                    }
                    
                    // Battle Charge: Knight powerup for low health bonus
                    if (unit.unitType === 'Knight' && unit.health < unit.maxHealth * 0.5) {
                        // Check if the knight has the battle charge powerup
                        const modifiers = this.getPowerupModifiers(unit.playerId, 'Knight');
                        if (this.playerPowerups[unit.playerId]?.knight?.battleCharge) {
                            finalDamage *= 1.25; // +25% damage
                            unit.speed = unit.speed * 1.5; // +50% speed (temporary)
                        }
                    }
                    
                    // Armor system with powerup enhancements
                    let armorReduction = target.armorReduction || 0;
                    if (armorReduction > 0) {
                        finalDamage *= (1 - armorReduction);
                    }
                    
                    // Damage reflection (Wizard powerup)
                    if (target.damageReflection && target.damageReflection > 0) {
                        const reflectedDamage = Math.floor(finalDamage * target.damageReflection);
                        unit.health = Math.max(0, unit.health - reflectedDamage);
                        // Create reflection animation
                        this.createAttackAnimation(target.x, target.y, unit.x, unit.y, 'damage_reflection');
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
                            // === Enhanced reward system for kills ===
                            const baseUnitReward = {
                                'Peasant': 15,   // Increased from 10
                                'Knight': 50,    // Increased from 40
                                'Archer': 100,   // Increased from 80
                                'King': 200,     // Increased from 150
                                'Wizard': 150    // Increased from 120
                            };
                            
                            let reward = baseUnitReward[target.unitType] || 15;
                            
                            // Bonus for high-value target kills
                            if (target.unitType === 'King') {
                                reward += 50; // Extra bonus for killing a King
                                // Create special animation for king kill
                                this.createAttackAnimation(target.x, target.y, target.x, target.y, 'king_kill_bonus');
                            } else if (target.unitType === 'Wizard') {
                                reward += 25; // Extra bonus for killing a Wizard
                            }
                            
                            // Critical hit bonus
                            if (unit.criticalChance && Math.random() < unit.criticalChance) {
                                reward = Math.floor(reward * 1.5); // 50% bonus for critical kills
                            }
                            
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
        });        // === BASE (CASTLE) ATTACK LOGIC ===
        this.players.forEach(player => {
            const base = this.playerBases[player.id];
            if (!base) return;

            // Initialize cooldown tracker if needed
            if (!this.baseAttackCooldowns[player.id]) {
                this.baseAttackCooldowns[player.id] = 0;
            }

            // Find enemy units in range
            const now = Date.now();
            const attackCooldown = base.attackCooldown || 1200;
            if (now - this.baseAttackCooldowns[player.id] >= attackCooldown) {
                const enemyUnits = this.units.filter(
                    unit =>
                        unit.playerId !== player.id &&
                        Math.abs(unit.x - base.x) <= base.attackRange &&
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
                    
                    // Handle different weapon types
                    if (base.weaponType === 'trebuchet') {
                        this.processCastleTrebuchetAttack(base, closest, now);
                    } else if (base.weaponType === 'wizard') {
                        this.processCastleWizardAttack(base, closest, now);
                    } else if (base.weaponType === 'arrows') {
                        // Rapid fire arrows
                        this.createAttackAnimation(base.x, base.y, closest.x, closest.y, 'castle_arrow');
                        closest.health = Math.max(0, closest.health - base.damage);
                    } else {
                        // Basic castle attack
                        this.createAttackAnimation(base.x, base.y, closest.x, closest.y, 'castle_basic');
                        closest.health = Math.max(0, closest.health - base.damage);
                    }
                    
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
        y = Math.max(laneTop + 10, Math.min(laneBottom - 10, y)); // 10px padding from lane edge        // Apply powerup modifiers
        const modifiers = this.getPowerupModifiers(playerId, unitType);
        
        const unit = {
            id: `unit_${Date.now()}_${Math.random()}`,
            x: playerIndex === 0 ? 120 : 1080,
            y,
            playerId: playerId,
            health: Math.floor(stats.health * modifiers.health),
            maxHealth: Math.floor(stats.health * modifiers.health),
            speed: stats.speed * modifiers.speed,
            damage: Math.floor(stats.damage * modifiers.damage),
            moving: true,
            unitType: unitType,
            size: stats.size,
            attackRange: stats.attackRange,
            attackCooldown: stats.attackCooldown,
            lastAttackTime: 0,
            lane: lane,
            // Store powerup modifiers for combat calculations
            armorReduction: (stats.armorReduction || 0) + modifiers.armorReduction,
            criticalChance: (stats.criticalChance || 0) + modifiers.criticalChance,
            auraRange: (stats.auraRange || 0) * modifiers.auraRange,
            auraDamageBonus: (stats.auraDamageBonus || 0) + modifiers.auraDamageBonus,
            immuneToCrits: modifiers.immuneToCrits,
            healthRegen: modifiers.healthRegen,
            damageReflection: modifiers.damageReflection,
            piercing: modifiers.piercing
        };

        // Add chain lightning properties for Wizard units
        if (unitType === 'Wizard' && stats.chainLightningRange && stats.chainLightningTargets) {
            unit.chainLightningRange = Math.floor(stats.chainLightningRange * modifiers.chainLightningRange);
            unit.chainLightningTargets = stats.chainLightningTargets + modifiers.chainLightningTargets;
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
    }    getGameState() {
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
            playerPowerups: this.playerPowerups
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

    socket.on('place-turret', ({ gameId, x, y, turretType }) => {
        const game = games.get(gameId);
        if (game) {
            const success = game.placeTurret(socket.id, x, y, turretType || 'basic');
            io.to(gameId).emit('game-updated', game.getGameState());
            socket.emit('turret-placed', { success });
        }
    });    socket.on('upgrade-turret', ({ gameId, turretId }) => {
        const game = games.get(gameId);
        if (game) {
            const success = game.upgradeTurret(socket.id, turretId);
            io.to(gameId).emit('game-updated', game.getGameState());
            socket.emit('turret-upgraded', { success });
        }
    });

    socket.on('upgrade-castle', ({ gameId }) => {
        const game = games.get(gameId);
        if (game) {
            const success = game.upgradeCastle(socket.id);
            io.to(gameId).emit('game-updated', game.getGameState());
            socket.emit('castle-upgraded', { success });
        }
    });

    socket.on('change-castle-weapon', ({ gameId, weaponType }) => {
        const game = games.get(gameId);
        if (game) {
            const success = game.changeCastleWeapon(socket.id, weaponType);
            io.to(gameId).emit('game-updated', game.getGameState());
            socket.emit('castle-weapon-changed', { success });
        }
    });    socket.on('place-mine', ({ gameId, x, y }) => {
        const game = games.get(gameId);
        if (game && game.placeMine(socket.id, x, y)) {
            io.to(gameId).emit('game-updated', game.getGameState());
        }
    });

    socket.on('purchase-powerup', ({ gameId, unitType, powerupName }) => {
        const game = games.get(gameId);
        if (game) {
            const success = game.purchasePowerup(socket.id, unitType, powerupName);
            io.to(gameId).emit('game-updated', game.getGameState());
            socket.emit('powerup-purchased', { success, unitType, powerupName });
        }
    });

    socket.on('upgrade-trap', ({ gameId, trapId }) => {
        const game = games.get(gameId);
        if (game) {
            const success = game.upgradeTrap(socket.id, trapId);
            io.to(gameId).emit('game-updated', game.getGameState());
            socket.emit('trap-upgraded', { success });
        }
    });

    socket.on('upgrade-mine', ({ gameId, mineId }) => {
        const game = games.get(gameId);
        if (game) {
            const success = game.upgradeMine(socket.id, mineId);
            io.to(gameId).emit('game-updated', game.getGameState());
            socket.emit('mine-upgraded', { success });
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