require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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
const STAFF_ROLE_ID = '1553324535128916070';    // Grader / Staff Role

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
  losses: { type: Number, default: 0 },
  kills: { type: Number, default: 0 },
  deaths: { type: Number, default: 0 }
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

// --- 🎛️ ALL SLASH COMMAND DEFINITIONS ---
const commands = [
  new SlashCommandBuilder()
    .setName('create-profile')
    .setDescription('Link Meta Username')
    .addStringOption(opt => opt.setName('meta_username').setDescription('Your exact Meta ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('queue-panel')
    .setDescription('Post 1v1 Arena Queue Panel (Staff Only)'),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Display the top 10 players currently leading the Arena standings.'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View an Arena match record dossier profile.')
    .addUserOption(opt => opt.setName('target').setDescription('Player to view stats for (Optional)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('addmmr')
    .setDescription('Staff Only: Manually add a specific amount of MMR to a player.')
    .addUserOption(opt => opt.setName('target').setDescription('Target player').setRequired(true))
    .addNumberOption(opt => opt.setName('amount').setDescription('Amount of MMR to add').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removemmr')
    .setDescription('Staff Only: Deduct a specific amount of MMR from a player.')
    .addUserOption(opt => opt.setName('target').setDescription('Target player').setRequired(true))
    .addNumberOption(opt => opt.setName('amount').setDescription('Amount of MMR to deduct').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setmmr')
    .setDescription('Staff Only: Override a player\'s MMR value to an exact number.')
    .addUserOption(opt => opt.setName('target').setDescription('Target player').setRequired(true))
    .addNumberOption(opt => opt.setName('value').setDescription('Exact MMR value').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clearallmmr')
    .setDescription('Staff Only: Permanently wipe the competitive leaderboard database.')
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

    if (interaction.commandName === 'leaderboard') {
      const sorted = await Player.find({}).sort({ mmr: -1 }).limit(10);
      if (sorted.length === 0) return interaction.reply({ content: "❌ Leaderboard is empty!", ephemeral: true });
      
      let text = `🥇 **Arena Leaderboard** 🥇\n\n`;
      sorted.forEach((p, i) => {
        text += `${i + 1}. **${p.username}** — [${getRankInfo(p.mmr).name}]${p.mmr.toFixed(0)} MMR\n`;
      });
      return interaction.reply({ content: text });
    }

    if (interaction.commandName === 'stats') {
      const targetUser = interaction.options.getUser('target') || interaction.user;
      const player = await Player.findOne({ userId: targetUser.id });

      if (!player) {
        return interaction.reply({ content: `❌ No competitive dossier found for <@${targetUser.id}>.`, ephemeral: true });
      }

      const rank = getRankInfo(player.mmr);
      const winRate = (player.wins + player.losses) > 0 
        ? ((player.wins / (player.wins + player.losses)) * 100).toFixed(1) 
        : '0.0';

      const embed = new EmbedBuilder()
        .setTitle(`📊 Arena Profile — ${player.username}`)
        .setColor(0x3498db)
        .addFields(
          { name: 'Meta Username', value: `\`${player.metaUsername || 'Not Linked'}\``, inline: true },
          { name: 'Current Rank', value: `**${rank.name}**`, inline: true },
          { name: 'MMR', value: `**${player.mmr.toFixed(0)}**`, inline: true },
          { name: 'Wins', value: `${player.wins}`, inline: true },
          { name: 'Losses', value: `${player.losses}`, inline: true },
          { name: 'Win Rate', value: `${winRate}%`, inline: true }
        );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'addmmr') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      const target = interaction.options.getUser('target');
      const amount = interaction.options.getNumber('amount');

      let player = await Player.findOne({ userId: target.id }) || new Player({ userId: target.id, username: target.username });
      player.mmr += amount;
      await player.save();

      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        updatePlayerRole(interaction.guild, member, player.mmr);
      }
      return interaction.reply({ content: `✅ Added **+${amount} MMR** to <@${target.id}>. New MMR: **${player.mmr.toFixed(0)}**` });
    }

    if (interaction.commandName === 'removemmr') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      const target = interaction.options.getUser('target');
      const amount = interaction.options.getNumber('amount');

      let player = await Player.findOne({ userId: target.id }) || new Player({ userId: target.id, username: target.username });
      player.mmr = Math.max(0, player.mmr - amount);
      await player.save();

      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        updatePlayerRole(interaction.guild, member, player.mmr);
      }
      return interaction.reply({ content: `✅ Deducted **-${amount} MMR** from <@${target.id}>. New MMR: **${player.mmr.toFixed(0)}**` });
    }

    if (interaction.commandName === 'setmmr') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      const target = interaction.options.getUser('target');
      const value = interaction.options.getNumber('value');

      let player = await Player.findOne({ userId: target.id }) || new Player({ userId: target.id, username: target.username });
      player.mmr = Math.max(0, value);
      await player.save();

      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        updatePlayerRole(interaction.guild, member, player.mmr);
      }
      return interaction.reply({ content: `✅ Set <@${target.id}>'s MMR to **${player.mmr.toFixed(0)}**.` });
    }

    if (interaction.commandName === 'clearallmmr') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      await Player.deleteMany({});
      return interaction.reply({ content: "⚠️ **Database Wiped:** All MMR records and player profiles have been reset." });
    }
  }

  // 2. Queue Buttons & Staff Modal Grading
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

    // Staff Grader Button Action
    if (interaction.customId.startsWith('grade_match_')) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ Access Denied: Grader/Staff permissions required.", ephemeral: true });
      }

      const [, , winnerId, loserId] = interaction.customId.split('_');

      const modal = new ModalBuilder()
        .setCustomId(`submit_grading_${winnerId}_${loserId}`)
        .setTitle('Enter Winner Statistics');

      const killsInput = new TextInputBuilder()
        .setCustomId('modal_kills')
        .setLabel('Winner Kills')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const deathsInput = new TextInputBuilder()
        .setCustomId('modal_deaths')
        .setLabel('Winner Deaths')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(killsInput),
        new ActionRowBuilder().addComponents(deathsInput)
      );

      await interaction.showModal(modal);
    }
  }

  // 3. Staff Modal Submission (Stats & MMR Update)
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('submit_grading_')) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      }

      const [, , winnerId, loserId] = interaction.customId.split('_');
      const kills = parseInt(interaction.fields.getTextInputValue('modal_kills'), 10);
      const deaths = parseInt(interaction.fields.getTextInputValue('modal_deaths'), 10);

      if (isNaN(kills) || isNaN(deaths) || kills < 0 || deaths < 0) {
        return interaction.reply({ content: '❌ Invalid numbers entered!', ephemeral: true });
      }

      await interaction.deferReply();

      // Update Winner
      let winner = await Player.findOne({ userId: winnerId }) || new Player({ userId: winnerId });
      const winUser = await client.users.fetch(winnerId).catch(() => null);
      if (winUser) winner.username = winUser.username;

      let winnerMmrChange = 7.5 + (kills * 0.20) - (deaths * 0.25);
      winner.wins += 1;
      winner.kills += kills;
      winner.deaths += deaths;
      winner.mmr = Math.max(0, winner.mmr + winnerMmrChange);
      await winner.save();

      // Update Loser
      let loser = await Player.findOne({ userId: loserId }) || new Player({ userId: loserId });
      const loseUser = await client.users.fetch(loserId).catch(() => null);
      if (loseUser) loser.username = loseUser.username;

      let loserMmrChange = -10 + (deaths * 0.20) - (kills * 0.25);
      loser.losses += 1;
      loser.kills += deaths;
      loser.deaths += kills;
      loser.mmr = Math.max(0, loser.mmr + loserMmrChange);
      await loser.save();

      // Update Discord Rank Roles
      if (interaction.guild) {
        const winMember = await interaction.guild.members.fetch(winnerId).catch(() => null);
        const loseMember = await interaction.guild.members.fetch(loserId).catch(() => null);
        updatePlayerRole(interaction.guild, winMember, winner.mmr);
        updatePlayerRole(interaction.guild, loseMember, loser.mmr);
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('✅ Match Graded & Finalized')
        .setColor(0x2ecc71)
        .setDescription(
          `**Grader:** ${interaction.user.username}\n\n` +
          `🏆 **Winner:** <@${winnerId}> (+${winnerMmrChange.toFixed(2)} MMR → **${winner.mmr.toFixed(0)} MMR**)\n` +
          `💀 **Loser:** <@${loserId}> (${loserMmrChange.toFixed(2)} MMR → **${loser.mmr.toFixed(0)} MMR**)`
        );

      await interaction.editReply({ embeds: [resultEmbed] });
      await interaction.channel.setArchived(true).catch(() => null);
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

  // Create match thread directly inside queue channel (1553779380218630264)
  const thread = await channel.threads.create({
    name: `⚔️ 1v1 Arena Match - Code ${roomCode}`,
    autoArchiveDuration: 60
  });

  const p1 = players[0];
  const p2 = players[1];

  const gradeP1Win = new ButtonBuilder()
    .setCustomId(`grade_match_${thread.id}_${p1.userId}_${p2.userId}`)
    .setLabel(`Grade Winner: ${p1.username}`)
    .setStyle(ButtonStyle.Success);

  const gradeP2Win = new ButtonBuilder()
    .setCustomId(`grade_match_${thread.id}_${p2.userId}_${p1.userId}`)
    .setLabel(`Grade Winner: ${p2.username}`)
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(gradeP1Win, gradeP2Win);

  const embed = new EmbedBuilder()
    .setTitle(`🏟️ 1v1 Arena Match Started`)
    .setColor(0x2ecc71)
    .setDescription(
      `🔑 **Private Room Code:** \`${roomCode}\`\n\n` +
      `👤 **Player 1:** <@${p1.userId}>\n` +
      `👤 **Player 2:** <@${p2.userId}>\n\n` +
      `**Instructions:**\n` +
      `1. Join Animal Company using code **${roomCode}**.\n` +
      `2. Once finished, upload your scoreboard/watch screenshot in this thread.\n` +
      `3. Mention <@&${STAFF_ROLE_ID}> so a grader can log the match!`
    );

  await thread.send({ 
    content: `<@${p1.userId}> vs <@${p2.userId}> | <@&${STAFF_ROLE_ID}>`, 
    embeds: [embed], 
    components: [row] 
  });
}

// --- 🌐 WEB SERVER & BOT LOGIN ---
http.createServer((req, res) => res.end('Bot active')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
