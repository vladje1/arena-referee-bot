require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');
const mongoose = require('mongoose');
const http = require('http');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// --- ⚙ CONFIGURATION ---
const QUEUE_CHANNEL_ID = 'YOUR_QUEUE_CHANNEL_ID'; 
const STAFF_ROLE_ID = '1553324535128916070';            
const EXTRA_STAFF_ROLE_ID = '1553324535128916070';     

// --- 📜 QUEST DEFINITIONS ---
const QUESTS = [
  { id: 'first_blood', title: 'First Blood', description: 'Get your very first recorded kill.', goal: 1, type: 'total_kills' },
  { id: 'brawler', title: 'Arena Brawler', description: 'Accumulate a total of 20 kills across matches.', goal: 20, type: 'total_kills' },
  { id: 'slayer', title: 'Massacre Machine', description: 'Rack up 60 total kills.', goal: 60, type: 'total_kills' },
  { id: 'survivor', title: 'Glutton for Punishment', description: 'Survive through 20 total deaths in matches.', goal: 20, type: 'total_deaths' }
];

// --- 🗄️ DATABASE SCHEMAS ---
const playerSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, default: 'Player' },
  metaUsername: { type: String, default: '' },
  kills: { type: Number, default: 0 },
  deaths: { type: Number, default: 0 },
  completedQuests: { type: [String], default: [] }
});
const Player = mongoose.model('Player', playerSchema);

mongoose.connect(process.env.MONGO_URI);

const active1v1Queue = [];
const pendingMatches = new Map();

// --- 🛠 BOT HELPER FUNCTIONS ---
function generateRoomCode() {
  return 'AC-' + Math.floor(1000 + Math.random() * 9000);
}

async function checkAndAwardQuests(player, guild, member) {
  let newlyCompleted = [];

  for (const quest of QUESTS) {
    if (player.completedQuests.includes(quest.id)) continue;

    let unlocked = false;
    if (quest.type === 'total_kills' && player.kills >= quest.goal) {
      unlocked = true;
    } else if (quest.type === 'total_deaths' && player.deaths >= quest.goal) {
      unlocked = true;
    }

    if (unlocked) {
      player.completedQuests.push(quest.id);
      newlyCompleted.push(quest);
    }
  }

  if (newlyCompleted.length > 0 && guild && member) {
    let questText = newlyCompleted.map(q => `• **${q.title}**`).join('\n');
    try {
      await member.send({
        content: `🎉 **Quest(s) Completed!**\nYou finished the following challenges:\n${questText}`
      }).catch(() => {});
    } catch (e) {}
  }
  return newlyCompleted.length > 0;
}

function isStaff(member) {
  return member && (
    member.permissions.has('Administrator') || 
    member.roles.cache.has(STAFF_ROLE_ID) || 
    member.roles.cache.has(EXTRA_STAFF_ROLE_ID)
  );
}

// --- 🎛️ SLASH COMMANDS ---
const commands = [
  new SlashCommandBuilder().setName('quests').setDescription('View your available and completed quests.'),
  new SlashCommandBuilder()
    .setName('reset-quests')
    .setDescription('Reset a user\'s completed quests (Staff Only)')
    .addUserOption(opt => opt.setName('user').setDescription('The user to reset').setRequired(true))
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`✅ Animal Company Bot Ready as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(console.error);
});

// --- 🎛️ INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'quests') {
      let player = await Player.findOne({ userId: interaction.user.id });
      if (!player) {
        player = await Player.create({ userId: interaction.user.id, username: interaction.user.username });
      }
      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        await checkAndAwardQuests(player, interaction.guild, member);
        await player.save();
      }
      const embed = new EmbedBuilder()
        .setTitle(`📜 Quests & Achievements — ${player.username}`)
        .setColor(0x9b59b6)
        .setDescription('Complete milestones through your gameplay!');
      for (const quest of QUESTS) {
        const isCompleted = player.completedQuests.includes(quest.id);
        let progressText = '';
        if (quest.type === 'total_kills') {
          progressText = `Progress: ${Math.min(player.kills, quest.goal)}/${quest.goal} Kills`;
        } else if (quest.type === 'total_deaths') {
          progressText = `Progress: ${Math.min(player.deaths, quest.goal)}/${quest.goal} Deaths`;
        }
        const statusIcon = isCompleted ? '✅ COMPLETED' : `⏳ *In Progress* (${progressText})`;
        embed.addFields({
          name: `${quest.title}`,
          value: `${quest.description}\n${statusIcon}`,
          inline: false
        });
      }
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'reset-quests') {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      }
      const targetUser = interaction.options.getUser('user');
      const player = await Player.findOne({ userId: targetUser.id });
      if (!player) {
        return interaction.reply({ content: `❌ No player profile found for ${targetUser.tag}.`, ephemeral: true });
      }
      player.completedQuests = [];
      await player.save();
      return interaction.reply({ content: `✅ Successfully reset all completed quests for <@${targetUser.id}>.`, ephemeral: true });
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'join_1v1_queue') {
      if (active1v1Queue.some(p => p.userId === interaction.user.id)) {
        return interaction.reply({ content: '⚠️ You are already in the queue!', ephemeral: true });
      }
      active1v1Queue.push({ userId: interaction.user.id, username: interaction.user.username });
      await interaction.reply({ content: `✅ Queued for 1v1! (${active1v1Queue.length}/2 players ready)`, ephemeral: true });
      if (active1v1Queue.length >= 2) {
        const players = active1v1Queue.splice(0, 2);
        start1v1Match(players, interaction.guild);
      }
    }
    if (interaction.customId === 'leave_1v1_queue') {
      const idx = active1v1Queue.findIndex(p => p.userId === interaction.user.id);
      if (idx !== -1) {
        active1v1Queue.splice(idx, 1);
        return interaction.reply({ content: '🏃 Removed from queue.', ephemeral: true });
      }
      return interaction.reply({ content: '🏃 You are not in the queue.', ephemeral: true });
    }
    if (interaction.customId.startsWith('accept_1v1_')) {
      const matchId = interaction.customId.replace('accept_1v1_', '');
      const match = pendingMatches.get(matchId);
      
      if (!match) {
        return interaction.reply({ content: '❌ Match session expired or cancelled.', ephemeral: true });
      }
      
      if (match.confirmedUsers.has(interaction.user.id)) {
        return interaction.reply({ content: '⚠️ You already accepted this match!', ephemeral: true });
      }

      match.confirmedUsers.add(interaction.user.id);

      const disabledBtn = new ButtonBuilder()
        .setCustomId(`accept_1v1_${matchId}`)
        .setLabel(match.confirmedUsers.size === 2 ? '✅ Match Starting!' : '✅ Confirmed (Waiting...)')
        .setStyle(ButtonStyle.Success)
        .setDisabled(true);
      const row = new ActionRowBuilder().addComponents(disabledBtn);

      await interaction.update({ components: [row] }).catch(() => {});

      if (match.confirmedUsers.size === 2) {
        clearTimeout(match.timeoutTimer);
        pendingMatches.delete(matchId);
        launch1v1Thread(match);
      }
    }
  }
});

async function start1v1Match(players, guild) {
  const matchId = `match_${Date.now()}`;
  const confirmedUsers = new Set();
  const confirmBtn = new ButtonBuilder().setCustomId(`accept_1v1_${matchId}`).setLabel('✅ Accept 1v1 (40s)').setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(confirmBtn);
  
  for (const p of players) {
    try {
      const user = await client.users.fetch(p.userId);
      await user.send({ content: '⚔️ 1v1 Arena Match Found! Press accept within 40 seconds.', components: [row] });
    } catch (e) {}
  }
  
  const timeoutTimer = setTimeout(() => {
    const cur = pendingMatches.get(matchId);
    if (cur) {
      pendingMatches.delete(matchId);
      for (const p of players) {
        if (cur.confirmedUsers.has(p.userId)) {
          active1v1Queue.push(p);
        }
      }
    }
  }, 40000);
  
  pendingMatches.set(matchId, { matchId, players, confirmedUsers, timeoutTimer, guild });
}

async function launch1v1Thread(matchData) {
  const { players, guild } = matchData;
  const channel = await guild.channels.fetch(QUEUE_CHANNEL_ID).catch(() => null);
  if (!channel) return;
  const roomCode = generateRoomCode();
  const thread = await channel.threads.create({
    name: `⚔ 1v1 Arena Match - Code ${roomCode}`,
    autoArchiveDuration: 60
  });
  const p1 = players[0];
  const p2 = players[1];
  const embed = new EmbedBuilder()
    .setTitle('🏟️ 1v1 Arena Match Started')
    .setColor(0x2ecc71)
    .setDescription(
      `🔑 **Private Room Code:** \`${roomCode}\`\n\n` +
      `👤 Player 1: <@${p1.userId}>\n` +
      `👤 Player 2: <@${p2.userId}>\n\n` +
      `Instructions:\n` +
      `1. Join Animal Company using code ${roomCode}.\n` +
      `2. Play your match!\n\n` +
      `⏳ This thread will automatically delete in 30 minutes.`
    );
  await thread.send({
    content: `<@${p1.userId}> vs <@${p2.userId}>`,
    embeds: [embed]
  });
  setTimeout(async () => {
    try {
      if (!thread.deleted) {
        await thread.delete('Match thread expired after 30 minutes.');
      }
    } catch (err) {
      console.error(`Failed to auto-delete thread ${thread.id}:`, err);
    }
  }, 1800000);
}

http.createServer((req, res) => res.end('Bot active')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
