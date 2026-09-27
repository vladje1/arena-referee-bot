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

// --- ⚙️ CONFIGURATION ---
const QUEUE_CHANNEL_ID = '1553779380218630264'; // Ranked Queue & Match Threads Channel
const STAFF_ROLE_ID = '1553324535128916070';    // Staff / Admin Role

// --- 📊 COMPETITIVE RANK ROLES ---
const RANK_ROLES = [
  { name: 'Champion', minMmr: 20000, id: '1553330980515741706' },
  { name: 'Ruby',     minMmr: 10000, id: '1553330712613093448' },
  { name: 'Emerald',  minMmr: 5000,  id: '1553330578298773534' },
  { name: 'Diamond',  minMmr: 1000,  id: '1553330139578769499' },
  { name: 'Platinum', minMmr: 500,   id: '1553330336795070575' },
  { name: 'Gold',     minMmr: 250,   id: '1553330034943463505' },
  { name: 'Silver',   minMmr: 100,   id: '1553329893687697418' },
  { name: 'Bronze',   minMmr: 0,     id: '1553329700749705226' }
];

// --- 🗄️ DATABASE SCHEMATIC ---
const playerSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, default: 'Player' },
  metaUsername: { type: String, default: '' },
  mmr: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

mongoose.connect(process.env.MONGO_URI);

// --- 🚦 MATCHMAKING QUEUE (1v1) ---
const active1v1Queue = [];
const pendingMatches = new Map();

// --- 🛠️ HELPER FUNCTIONS ---
function getRankInfo(mmr) {
  return RANK_ROLES.find(rank => mmr >= rank.minMmr) || RANK_ROLES[RANK_ROLES.length - 1];
}

function generateRoomCode() {
  return 'AC-' + Math.floor(1000 + Math.random() * 9000);
}

async function updatePlayerRole(guild, member, currentMmr) {
  if (!member) return null;
  const targetRank = getRankInfo(currentMmr);
  const hasTarget = member.roles.cache.has(targetRank.id);
  const rolesToRemove = RANK_ROLES.filter(rank => rank.id !== targetRank.id && member.roles.cache.has(rank.id));

  if (rolesToRemove.length > 0) {
    await Promise.all(rolesToRemove.map(rank => member.roles.remove(rank.id).catch(() => null)));
  }

  if (!hasTarget) {
    await member.roles.add(targetRank.id).catch(() => null);
    return targetRank.name;
  }
  return null;
}

function isStaff(member) {
  return member && (member.permissions.has('Administrator') || member.roles.cache.has(STAFF_ROLE_ID));
}

// --- 🎛️ SLASH COMMAND DEFINITIONS ---
const commands = [
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show top ranked players'),
  new SlashCommandBuilder().setName('queue-panel').setDescription('Post 1v1 Arena Queue Panel (Staff Only)'),
  new SlashCommandBuilder()
    .setName('create-profile')
    .setDescription('Link Meta Username')
    .addStringOption(opt => opt.setName('meta_username').setDescription('Your exact Meta ID').setRequired(true))
].map(c => c.toJSON());

// --- 🤖 BOT READY ---
client.once('ready', async () => {
  console.log(`✅ Animal Company Bot Ready as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(console.error);
});

// --- 🎛️ INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {

  // 1. Slash Commands
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'leaderboard') {
      const sorted = await Player.find({}).sort({ mmr: -1 }).limit(10);
      if (sorted.length === 0) return interaction.reply({ content: "❌ Leaderboard is empty!", ephemeral: true });
      
      let text = `🥇 **Arena Leaderboard** 🥇\n\n`;
      sorted.forEach((p, i) => {
        text += `${i + 1}. **${p.username}** — [${getRankInfo(p.mmr).name}]${p.mmr.toFixed(0)} MMR\n`;
      });
      return interaction.reply({ content: text });
    }

    if (interaction.commandName === 'create-profile') {
      const metaUsername = interaction.options.getString('meta_username');
      await Player.findOneAndUpdate(
        { userId: interaction.user.id },
        { userId: interaction.user.id, username: interaction.user.username, metaUsername: metaUsername },
        { upsert: true }
      );
      return interaction.reply({ content: `✅ Account registered! Meta ID: \`${metaUsername}\``, ephemeral: true });
    }

    if (interaction.commandName === 'queue-panel') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });

      const joinBtn = new ButtonBuilder().setCustomId('join_1v1_queue').setLabel('⚔️ Join 1v1 Queue').setStyle(ButtonStyle.Success);
      const leaveBtn = new ButtonBuilder().setCustomId('leave_1v1_queue').setLabel('❌ Leave Queue').setStyle(ButtonStyle.Danger);
      const row = new ActionRowBuilder().addComponents(joinBtn, leaveBtn);

      const embed = new EmbedBuilder()
        .setTitle('🏆 Animal Company 1v1 Arena Queue')
        .setColor(0x2b2d31)
        .setDescription('Click below to queue up for a 1v1 Arena match!\nMake sure you link your Meta ID first via `/create-profile`.');

      return interaction.reply({ embeds: [embed], components: [row] });
    }
  }

  // 2. Queue Buttons & Win Reporting
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
      return interaction.reply({ content: '⚠️ You are not in the queue.', ephemeral: true });
    }

    if (interaction.customId.startsWith('accept_1v1_')) {
      const matchId = interaction.customId.replace('accept_1v1_', '');
      const match = pendingMatches.get(matchId);
      if (!match) return interaction.reply({ content: '❌ Match session expired or cancelled.', ephemeral: true });

      match.confirmedUsers.add(interaction.user.id);
      await interaction.reply({ content: '✅ Confirmed! Waiting for opponent...' });

      if (match.confirmedUsers.size === 2) {
        clearTimeout(match.timeoutTimer);
        pendingMatches.delete(matchId);
        launch1v1Thread(match);
      }
    }

    // Direct Match Result Reporting by Players
    if (interaction.customId.startsWith('report_win_')) {
      const [, , winnerId, loserId] = interaction.customId.split('_');

      if (interaction.user.id !== winnerId && interaction.user.id !== loserId && !isStaff(interaction.member)) {
        return interaction.reply({ content: '❌ Only players in this match can report the result!', ephemeral: true });
      }

      await interaction.deferReply();

      // Update Winner
      let winner = await Player.findOne({ userId: winnerId }) || new Player({ userId: winnerId });
      const winUser = await client.users.fetch(winnerId).catch(() => null);
      if (winUser) winner.username = winUser.username;

      const winnerGain = 25;
      winner.wins += 1;
      winner.mmr += winnerGain;
      await winner.save();

      // Update Loser
      let loser = await Player.findOne({ userId: loserId }) || new Player({ userId: loserId });
      const loseUser = await client.users.fetch(loserId).catch(() => null);
      if (loseUser) loser.username = loseUser.username;

      const loserLoss = 15;
      loser.losses += 1;
      loser.mmr = Math.max(0, loser.mmr - loserLoss);
      await loser.save();

      // Update Discord Rank Roles
      if (interaction.guild) {
        const winMember = await interaction.guild.members.fetch(winnerId).catch(() => null);
        const loseMember = await interaction.guild.members.fetch(loserId).catch(() => null);
        updatePlayerRole(interaction.guild, winMember, winner.mmr);
        updatePlayerRole(interaction.guild, loseMember, loser.mmr);
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('🏆 Match Results Recorded')
        .setColor(0x2ecc71)
        .setDescription(
          `**Winner:** <@${winnerId}> (+${winnerGain} MMR → **${winner.mmr.toFixed(0)} MMR**)\n` +
          `**Loser:** <@${loserId}> (-${loserLoss} MMR → **${loser.mmr.toFixed(0)} MMR**)\n\n` +
          `This thread will auto-archive shortly.`
        );

      await interaction.editReply({ embeds: [resultEmbed] });

      setTimeout(() => {
        interaction.channel.setArchived(true).catch(() => null);
      }, 5000);
    }
  }
});

// --- 📩 1v1 MATCH CONFIRMATION & THREAD LAUNCH ---
async function start1v1Match(players, guild) {
  const matchId = `match_${Date.now()}`;
  const confirmedUsers = new Set();

  const confirmBtn = new ButtonBuilder().setCustomId(`accept_1v1_${matchId}`).setLabel('✅ Accept 1v1 (40s)').setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(confirmBtn);

  for (const p of players) {
    try {
      const user = await client.users.fetch(p.userId);
      await user.send({ content: '⚔️ **1v1 Arena Match Found!** Press accept within 40 seconds.', components: [row] });
    } catch (e) {}
  }

  const timeoutTimer = setTimeout(() => {
    const cur = pendingMatches.get(matchId);
    if (cur) {
      pendingMatches.delete(matchId);
      for (const p of players) {
        if (cur.confirmedUsers.has(p.userId)) active1v1Queue.push(p);
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

  // Create match thread in channel: 1553779380218630264
  const thread = await channel.threads.create({
    name: `⚔️ 1v1 Arena Match - Code ${roomCode}`,
    autoArchiveDuration: 60
  });

  const p1 = players[0];
  const p2 = players[1];

  const reportP1Win = new ButtonBuilder()
    .setCustomId(`report_win_${thread.id}_${p1.userId}_${p2.userId}`)
    .setLabel(`${p1.username} Won`)
    .setStyle(ButtonStyle.Success);

  const reportP2Win = new ButtonBuilder()
    .setCustomId(`report_win_${thread.id}_${p2.userId}_${p1.userId}`)
    .setLabel(`${p2.username} Won`)
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(reportP1Win, reportP2Win);

  const embed = new EmbedBuilder()
    .setTitle(`🏟️ 1v1 Arena Match Started`)
    .setColor(0x2ecc71)
    .setDescription(
      `🔑 **Private Room Code:** \`${roomCode}\`\n\n` +
      `👤 **Player 1:** <@${p1.userId}>\n` +
      `👤 **Player 2:** <@${p2.userId}>\n\n` +
      `**How to Record Match Result:**\n` +
      `1. Join Animal Company using code **${roomCode}**.\n` +
      `2. Once finished, click the corresponding button below to confirm the winner!`
    );

  await thread.send({ 
    content: `<@${p1.userId}> vs <@${p2.userId}>`, 
    embeds: [embed], 
    components: [row] 
  });
}

// --- 🌐 WEB SERVER & BOT LOGIN ---
http.createServer((req, res) => res.end('Bot active')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
