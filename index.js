const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits } = require('discord.js');

// Discord Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

// Lista monitorowanych graczy
const MONITORED_PLAYERS = [
    'Barpad',        // Gracz 1
    'N1_Bobcat8903', // Gracz 2
    '15ms',          // Gracz 3
    'xKredka',       // Gracz 4
];

// Discord client initialization
const discord = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

discord.login(DISCORD_TOKEN);

// Configuration
const SERVER_HOST = process.env.SERVER_HOST || 'n1mc.pl';
const SERVER_PORT = process.env.SERVER_PORT || 25565;
const WAIT_TIME = 5000; // 5 seconds in milliseconds

// Bot credentials
const BOT_USERNAME = process.env.BOT_USERNAME;
const BOT_PASSWORD = process.env.BOT_PASSWORD;

console.log(`Starting Minecraft bot with username: ${BOT_USERNAME}`);
console.log(`Using password: ${BOT_PASSWORD}`);

// Phase tracking
let currentPhase = 'connecting';
let registrationComplete = false;

function createBot() {
    const bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: BOT_USERNAME,
        version: '1.20.1', // Use specific version instead of auto-detect
        auth: 'offline', // Use offline mode for cracked servers
        hideErrors: false,
        skipValidation: true,
        checkTimeoutInterval: 30000
    });

    // Connection successful
    bot.on('spawn', () => {
        console.log(`✅ Bot connected to ${SERVER_HOST}:${SERVER_PORT}`);
        console.log('🤖 Bot spawned in game world');
        
        if (currentPhase === 'connecting') {
            console.log('⏳ Waiting 5 seconds before registration...');
            setTimeout(() => {
                registerBot(bot);
            }, 5000); // Original timing restored
        } else if (currentPhase === 'reconnecting') {
            console.log('⏳ Waiting for anti-bot checks before login...');
            setTimeout(() => {
                loginBot(bot);
            }, 15000); // Wait longer for server to recognize existing account
        }
    });

    // Handle login sequence - some servers require this
    bot.on('login', () => {
        console.log('🔑 Login packet received from server');
    });

    // Handle chat messages from server
    bot.on('message', (message) => {
        const messageText = message.toString();
        console.log(`📢 Server message: ${messageText}`);
        
        // Auto-execute registration when server asks and anti-bot is complete
        if (currentPhase === 'connecting' && messageText.includes('Wpisz /register')) {
            console.log('🤖 Server requesting registration - executing immediately!');
            registerBot(bot);
        }
        
        // Auto-execute login when server asks for it (account already exists)
        if (currentPhase === 'connecting' && messageText.includes('Wpisz /login')) {
            console.log('🤖 Account exists! Server requesting login - executing immediately!');
            currentPhase = 'logging_in';
            setTimeout(() => {
                const loginCommand = `/login ${BOT_PASSWORD}`;
                console.log(`🔐 Executing login command: /login ${BOT_PASSWORD}`);
                bot.chat(loginCommand);
            }, 2000);
        }
        
        // Check for registration success/failure
        if (currentPhase === 'registering') {
            if (messageText.toLowerCase().includes('zalożone') || messageText.toLowerCase().includes('successful')) {
                console.log('✅ Registration successful!');
                registrationComplete = true;
                setTimeout(() => {
                    disconnectAndReconnect(bot);
                }, 2000);
            } else if (messageText.toLowerCase().includes('already') ||
                      messageText.toLowerCase().includes('już') ||
                      messageText.toLowerCase().includes('istnieje')) {
                console.log('⚠️ Username already registered, proceeding to login...');
                registrationComplete = true;
                setTimeout(() => {
                    disconnectAndReconnect(bot);
                }, 2000);
            }
        }
        
        // Check for login success - look for any success indicators
        if (currentPhase === 'logging_in') {
            if (messageText.toLowerCase().includes('zalogowano') || 
                messageText.toLowerCase().includes('logged') ||
                messageText.toLowerCase().includes('successful') ||
                messageText.toLowerCase().includes('ok') ||
                messageText.toLowerCase().includes('welcome') ||
                messageText.toLowerCase().includes('lobby')) {
                console.log('✅ Login successful! Bot is now in lobby!');
                console.log('🎯 SUCCESS! Bot reached lobby and is monitoring players!');
                currentPhase = 'monitoring_lobby';
                startLobbyMonitoring(bot);
            }
        }
        
        // Also check if bot automatically gets to lobby after anti-bot tests
        if (currentPhase === 'logging_in' && messageText.includes('ANTI-BOT - OK') && !messageText.includes('CHECK')) {
            setTimeout(() => {
                if (currentPhase === 'logging_in') {
                    console.log('✅ Anti-bot tests completed! Assuming login success!');
                    console.log('🎯 SUCCESS! Bot should now be in lobby - starting monitoring!');
                    currentPhase = 'monitoring_lobby';
                    startLobbyMonitoring(bot);
                }
            }, 3000);
        }
        
        // Handle case where server still asks for registration after reconnect
        if (currentPhase === 'reconnecting' && messageText.includes('/register')) {
            console.log('⚠️ Server asking for registration after reconnect - will try login anyway...');
        }
    });

    // Handle connection errors
    bot.on('error', (err) => {
        console.error('❌ Bot error:', err.message);
        
        if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
            console.error('🌐 Connection failed. Please check server address and internet connection.');
        } else if (err.message.includes('Invalid session')) {
            console.error('🔐 Authentication failed. Using offline mode.');
        }
        
        // Retry connection after delay
        setTimeout(() => {
            console.log('🔄 Retrying connection in 10 seconds...');
            createBot();
        }, 10000);
    });

    // Handle disconnection
    bot.on('end', (reason) => {
        console.log(`🔌 Disconnected from server. Reason: ${reason || 'Unknown'}`);
        
        if (currentPhase === 'disconnecting_for_reconnect') {
            console.log('🔄 Reconnecting for login phase...');
            currentPhase = 'reconnecting';
            setTimeout(() => {
                createBot();
            }, 2000);
        }
    });

    // Handle kick events
    bot.on('kicked', (reason) => {
        console.log(`👢 Bot was kicked from server. Reason: ${reason}`);
        
        // Try to understand kick reason and retry if appropriate
        const reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : reason;
        console.log(`📝 Full kick reason: ${reasonStr}`);
        
        // Check if kicked due to successful registration
        if (reasonStr && (reasonStr.includes('Konto zostało zalożone') || reasonStr.includes('Wejdz ponownie'))) {
            console.log('✅ Registration successful! Server requires reconnection.');
            registrationComplete = true;
            currentPhase = 'reconnecting';
            setTimeout(() => {
                console.log('🔄 Reconnecting for login phase...');
                createBot();
            }, 3000);
        } else if (reasonStr && (reasonStr.includes('bot') || reasonStr.includes('anti') || reasonStr.includes('protection'))) {
            console.log('🛡️ Kicked by anti-bot protection, trying again with different approach...');
            setTimeout(() => {
                console.log('🔄 Retrying connection...');
                createBot();
            }, 15000); // Wait longer before retry
        }
    });

    return bot;
}

function registerBot(bot) {
    console.log('📝 Starting registration process...');
    currentPhase = 'registering';
    
    try {
        const registerCommand = `/register ${BOT_PASSWORD} ${BOT_PASSWORD}`;
        console.log(`🔐 Executing registration command: /register [password] [password]`);
        bot.chat(registerCommand);
        
        // Timeout for registration
        setTimeout(() => {
            if (!registrationComplete && currentPhase === 'registering') {
                console.log('⏰ Registration timeout, proceeding to disconnect...');
                disconnectAndReconnect(bot);
            }
        }, 10000);
        
    } catch (error) {
        console.error('❌ Error during registration:', error.message);
        disconnectAndReconnect(bot);
    }
}

function loginBot(bot) {
    console.log('🔑 Starting login process...');
    currentPhase = 'logging_in';
    
    try {
        const loginCommand = `/login ${BOT_PASSWORD}`;
        console.log(`🔐 Executing login command: /login ${BOT_PASSWORD}`);
        bot.chat(loginCommand);
        
        // Give more time for login and stay connected to analyze lobby
        setTimeout(() => {
            if (currentPhase === 'logging_in') {
                console.log('✅ Login command sent! Bot should now be in lobby.');
                console.log('🎯 Bot is now monitoring the lobby for new players...');
                currentPhase = 'monitoring_lobby';
                startLobbyMonitoring(bot);
            }
        }, 5000);
        
    } catch (error) {
        console.error('❌ Error during login:', error.message);
        bot.quit();
    }
}

function startLobbyMonitoring(bot) {
    console.log('👀 Starting lobby monitoring - watching for new players...');
    
    // Funkcja do wysyłania wiadomości na Discord
    const sendDiscordMessage = async (message) => {
        try {
            const channel = await discord.channels.fetch(DISCORD_CHANNEL_ID);
            if (channel) {
                await channel.send(message);
                console.log('✅ Wysłano powiadomienie na Discord');
            }
        } catch (error) {
            console.error('❌ Błąd wysyłania wiadomości na Discord:', error);
        }
    };

    // Monitor player joins
    bot.on('playerJoined', (player) => {
        console.log(`🟢 NEW PLAYER JOINED: ${player.username} at ${new Date().toLocaleTimeString()}`);
        
        // Sprawdź czy gracz jest na liście monitorowanych
        if (MONITORED_PLAYERS.includes(player.username)) {
            const message = `🚨 @here logajcie! 🎮 **${player.username}** jest na serwerze!!! 🔥`;
            sendDiscordMessage(message);
        }
    });
    
    // Monitor chat messages in lobby
    bot.on('message', (message) => {
        const messageText = message.toString();
        if (!messageText.includes('ANTI-BOT') && !messageText.includes('Ping')) {
            console.log(`💬 LOBBY CHAT: ${messageText}`);
        }
    });
    
    console.log('📊 Lobby monitoring active - bot will stay connected and report player activity');
}

function disconnectAndReconnect(bot) {
    console.log('🔄 Disconnecting for reconnection...');
    currentPhase = 'disconnecting_for_reconnect';
    
    try {
        bot.quit();
    } catch (error) {
        console.error('❌ Error during disconnect:', error.message);
        // Force reconnection even if disconnect fails
        currentPhase = 'reconnecting';
        setTimeout(() => {
            createBot();
        }, 3000);
    }
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n🛑 Received interrupt signal. Shutting down gracefully...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught exception:', error.message);
    console.error(error.stack);
    process.exit(1);
});

// Start the bot
console.log('🚀 Starting Minecraft registration bot...');
console.log(`🎯 Target server: ${SERVER_HOST}:${SERVER_PORT}`);
console.log('📋 Process: Connect → Wait → Register → Disconnect → Reconnect → Wait → Login');
console.log('─'.repeat(60));

createBot();
