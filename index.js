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
const crypto = require('crypto');
const axios = require('axios');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// --- ⚙️ CONFIGURATION ---
const QUEUE_CHANNEL_ID = '1553779380218630264';         // Ranked Queue & Match Threads Channel
const MATCH_RESULTS_CHANNEL_ID = '1553172302420643950'; // #match-results Channel (Pubs)
const APPROVAL_CHANNEL_ID = '1553177031523700838';      // #approve Channel (Staff Review)
const STAFF_ROLE_ID = '1553324535128916070';            // Grader / Staff Role
const BYPASS_USER_ID = '1497289874653450240';           // User allowed to bypass duplicate image check

// --- 📊 COMPETITIVE RANK ROLES ---
const CHAMPION_ROLE_ID = '1553330980515741706';          // Exclusive #1 Leaderboard Rank (Min 20k MMR)[cite: 5]
const RANK_ROLES = [
  { name: 'Grandmaster', minMmr: 17000, id: '1554029837180735569' },[cite: 5]
  { name: 'Master',      minMmr: 14000, id: '1554029406828240956' },[cite: 5]
  { name: 'Crimson',     minMmr: 12000, id: '1554029250556858428' },[cite: 5]
  { name: 'Ruby',        minMmr: 10000, id: '1553330712613093448' },[cite: 5]
  { name: 'Emerald',     minMmr: 5000,  id: '1553330578298773534' },[cite: 5]
  { name: 'Azure',       minMmr: 4000,  id: '1554030447577538661' },[cite: 5]
  { name: 'Sapphire',    minMmr: 3000,  id: '1554029074345627688' },[cite: 5]
  { name: 'Amethyst',    minMmr: 2000,  id: '1554028829662781550' },[cite: 5]
  { name: 'Diamond',     minMmr: 1000,  id: '1553330139578769499' },[cite: 5]
  { name: 'Platinum',    minMmr: 500,   id: '1553330336795070575' },[cite: 5]
  { name: 'Gold',        minMmr: 250,   id: '1553330034943463505' },[cite: 5]
  { name: 'Silver',      minMmr: 100,   id: '1553329893687697418' },[cite: 5]
  { name: 'Bronze',      minMmr: 0,     id: '1553329700749705226' }[cite: 5]
];

// --- 📜 QUEST DEFINITIONS ---
const QUESTS = [
  { id: 'first_blood', title: 'First Blood', description: 'Get your very first recorded kill.', goal: 1, type: 'total_kills', rewardMmr: 25 },
  { id: 'brawler', title: 'Arena Brawler', description: 'Accumulate a total of 20 kills across matches.', goal: 20, type: 'total_kills', rewardMmr: 50 },
  { id: 'slayer', title: 'Massacre Machine', description: 'Rack up 60 total kills.', goal: 60, type: 'total_kills', rewardMmr: 150 },
  { id: 'survivor', title: 'Glutton for Punishment', description: 'Survive through 20 total deaths in matches.', goal: 20, type: 'total_deaths', rewardMmr: 40 },
  { id: 'climber', title: 'Rising Star', description: 'Reach the Gold rank or higher.', minMmr: 250, type: 'rank', rewardMmr: 75 },
  { id: 'elite', title: 'Elite Operator', description: 'Reach the Diamond rank or higher.', minMmr: 1000, type: 'rank', rewardMmr: 200 }
];

// --- 🗄️ DATABASE SCHEMAS ---
const playerSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, default: 'Player' },
  metaUsername: { type: String, default: '' },
  mmr: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  kills: { type: Number, default: 0 },
  deaths: { type: Number, default: 0 },
  completedQuests: { type: [String], default: [] }
});
const Player = mongoose.model('Player', playerSchema);

mongoose.connect(process.env.MONGO_URI);

// --- 🚦 MATCHMAKING QUEUE (1v1) ---
const active1v1Queue = [];
const pendingMatches = new Map();
const matchPlayersCache = new Map(); 
const recentImageHashes = new Set(); 

// --- 🛠️ HELPER FUNCTIONS ---
function getRankInfo(mmr) {
  return RANK_ROLES.find(rank => mmr >= rank.minMmr) || RANK_ROLES[RANK_ROLES.length - 1];
}

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
    } else if (quest.type === 'rank' && player.mmr >= quest.minMmr) {
      unlocked = true;
    }

    if (unlocked) {
      player.completedQuests.push(quest.id);
      player.mmr += quest.rewardMmr;
      newlyCompleted.push(quest);
    }
  }

  if (newlyCompleted.length > 0 && guild && member) {
    let questText = newlyCompleted.map(q => `• **${q.title}** (+${q.rewardMmr} MMR)`).join('\n');
    try {
      await member.send({
        content: `🎉 **Quest(s) Completed!**\nYou finished the following challenges:\n${questText}\nYour MMR has been updated!`
      }).catch(() => {});
    } catch (e) {}
  }

  return newlyCompleted.length > 0;
}

async function updatePlayerRole(guild, member, currentMmr) {
  if (!member) return null;
  
  const targetRank = getRankInfo(currentMmr);
  const standardRoles = RANK_ROLES.map(r => r.id);
  const rolesToRemove = standardRoles.filter(id => id !== targetRank.id && member.roles.cache.has(id));

  if (rolesToRemove.length > 0) {
    await Promise.all(rolesToRemove.map(id => member.roles.remove(id).catch(() => null)));
  }

  if (!member.roles.cache.has(targetRank.id)) {
    await member.roles.add(targetRank.id).catch(() => null);
  }

  await refreshChampionRole(guild);
  return targetRank.name;
}

async function refreshChampionRole(guild) {
  if (!guild) return;
  try {
    const topPlayer = await Player.findOne({}).sort({ mmr: -1 });
    const championRole = await guild.roles.fetch(CHAMPION_ROLE_ID).catch(() => null);
    if (!championRole) return;

    for (const [memberId, member] of championRole.members) {
      await member.roles.remove(CHAMPION_ROLE_ID).catch(() => null);
    }

    if (topPlayer && topPlayer.mmr >= 20000) {[cite: 5]
      const topMember = await guild.members.fetch(topPlayer.userId).catch(() => null);
      if (topMember) {
        await topMember.roles.add(CHAMPION_ROLE_ID).catch(() => null);
      }
    }
  } catch (err) {
    console.error("Error refreshing Champion role:", err);
  }
}

function isStaff(member) {
  return member && (member.permissions.has('Administrator') || member.roles.cache.has(STAFF_ROLE_ID));
}

// --- 🎛️ SLASH COMMANDS ---
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
    .setDescription('Display top 10 Arena standings.'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View Arena profile.')
    .addUserOption(opt => opt.setName('target').setDescription('Player (Optional)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('quests')
    .setDescription('View your available and completed quests & rewards.'),

  new SlashCommandBuilder()
    .setName('addmmr')
    .setDescription('Staff Only: Add MMR')
    .addUserOption(opt => opt.setName('target').setDescription('Target player').setRequired(true))
    .addNumberOption(opt => opt.setName('amount').setDescription('Amount').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removemmr')
    .setDescription('Staff Only: Remove MMR')
    .addUserOption(opt => opt.setName('target').setDescription('Target player').setRequired(true))
    .addNumberOption(opt => opt.setName('amount').setDescription('Amount').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setmmr')
    .setDescription('Staff Only: Set exact MMR')
    .addUserOption(opt => opt.setName('target').setDescription('Target player').setRequired(true))
    .addNumberOption(opt => opt.setName('value').setDescription('Exact value').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clearallmmr')
    .setDescription('Staff Only: Wipe database')
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`✅ Animal Company Bot Ready as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(console.error);
});

// --- 📩 LISTEN FOR SCREENSHOTS (THREADS vs PUBS) ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isMatchThread = message.channel.isThread() && message.channel.parentId === QUEUE_CHANNEL_ID;
  const isMatchResultsChannel = message.channel.id === MATCH_RESULTS_CHANNEL_ID;

  if ((isMatchThread || isMatchResultsChannel) && message.attachments.size > 0) {
    const attachment = message.attachments.first();

    if (attachment.contentType && attachment.contentType.startsWith('image/')) {
      
      if (message.author.id !== BYPASS_USER_ID) {
        try {
          const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
          const imageHash = crypto.createHash('md5').update(response.data).digest('hex');

          if (recentImageHashes.has(imageHash)) {
            await message.delete().catch(() => {});
            const warning = await message.channel.send(`⚠️ <@${message.author.id}> This exact image has already been submitted or used! Duplicate screenshots are not allowed.`);
            setTimeout(() => warning.delete().catch(() => {}), 5000);
            return;
          }

          recentImageHashes.add(imageHash);
          setTimeout(() => recentImageHashes.delete(imageHash), 7200000); 
        } catch (err) {
          console.error("Error hashing image:", err);
        }
      }

      const approvalChannel = await message.guild.channels.fetch(APPROVAL_CHANNEL_ID).catch(() => null);
      if (!approvalChannel) return;

      const actionRow = new ActionRowBuilder();
      let approveEmbed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setImage(attachment.url);

      if (isMatchThread) {
        let players = matchPlayersCache.get(message.channel.id) || [message.author.id, null];
        approveEmbed
          .setTitle('🔎 Match Thread Result Pending')
          .setDescription(`**Submitter:** <@${message.author.id}>\n**Thread:** <#${message.channel.id}>\n**Jump:** [Message Link](${message.url})`);

        if (players[1]) {
          const user1 = await client.users.fetch(players[0]).catch(() => ({ username: 'Player 1' }));
          const user2 = await client.users.fetch(players[1]).catch(() => ({ username: 'Player 2' }));

          actionRow.addComponents(
            new ButtonBuilder().setCustomId(`thread_win_${players[0]}_${players[1]}_${message.channel.id}`).setLabel(`Grade ${user1.username} Win`).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`thread_win_${players[1]}_${players[0]}_${message.channel.id}`).setLabel(`Grade ${user2.username} Win`).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`approve_reject_${message.channel.id}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
          );
        } else {
          actionRow.addComponents(
            new ButtonBuilder().setCustomId(`approve_manual_${message.author.id}_${message.channel.id}`).setLabel('✅ Grade Match').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`approve_reject_${message.channel.id}`).setLabel('❌ Reject').setStyle(ButtonStyle.Danger)
          );
        }

      } else if (isMatchResultsChannel) {
        approveEmbed
          .setTitle('🔎 Pubs Match Result Pending (#match-results)')
          .setDescription(`**Submitter:** <@${message.author.id}>\n**Channel:** <#${message.channel.id}>\n**Jump:** [Message Link](${message.url})`);

        actionRow.addComponents(
          new ButtonBuilder().setCustomId(`pub_win_${message.author.id}_${message.channel.id}`).setLabel('Win').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`pub_lose_${message.author.id}_${message.channel.id}`).setLabel('Lose').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`approve_reject_${message.channel.id}`).setLabel('Reject').setStyle(ButtonStyle.Secondary)
        );
      }

      await approvalChannel.send({
        content: `<@&${STAFF_ROLE_ID}> New match screenshot submitted for review:`,
        embeds: [approveEmbed],
        components: [actionRow]
      });
    }
  }
});

// --- 🎛️ INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'create-profile') {
      const metaUsername = interaction.options.getString('meta_username');
      await Player.findOneAndUpdate(
        { userId: interaction.user.id },
        { userId: interaction.user.id, username: interaction.user.username, metaUsername: metaUsername },
        { upsert: true }
      );
      if (interaction.guild) {
        await refreshChampionRole(interaction.guild);
      }
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
        const isChamp = i === 0 && p.mmr >= 20000;[cite: 5]
        const rankName = isChamp ? '👑 Champion' : getRankInfo(p.mmr).name;[cite: 5]
        text += `${i + 1}. **${p.username}** — [${rankName}]${p.mmr.toFixed(0)} MMR\n`;
      });
      return interaction.reply({ content: text });
    }

    if (interaction.commandName === 'stats') {
      const targetUser = interaction.options.getUser('target') || interaction.user;
      const player = await Player.findOne({ userId: targetUser.id });

      if (!player) {
        return interaction.reply({ content: `❌ No competitive dossier found for <@${targetUser.id}>.`, ephemeral: true });
      }

      const topPlayer = await Player.findOne({}).sort({ mmr: -1 });
      const isChamp = topPlayer && topPlayer.userId === targetUser.id && player.mmr >= 20000;[cite: 5]
      const rankName = isChamp ? '👑 Champion' : getRankInfo(player.mmr).name;[cite: 5]

      const winRate = (player.wins + player.losses) > 0 
        ? ((player.wins / (player.wins + player.losses)) * 100).toFixed(1) 
        : '0.0';

      const embed = new EmbedBuilder()
        .setTitle(`📊 Arena Profile — ${player.username}`)
        .setColor(0x3498db)
        .addFields(
          { name: 'Meta Username', value: `\`${player.metaUsername || 'Not Linked'}\``, inline: true },
          { name: 'Current Rank', value: `**${rankName}**`, inline: true },
          { name: 'MMR', value: `**${player.mmr.toFixed(0)}**`, inline: true },
          { name: 'Wins', value: `${player.wins}`, inline: true },
          { name: 'Losses', value: `${player.losses}`, inline: true },
          { name: 'Win Rate', value: `${winRate}%`, inline: true }
        );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'quests') {
      let player = await Player.findOne({ userId: interaction.user.id });
      if (!player) {
        return interaction.reply({ content: `❌ You need to register a profile first using \`/create-profile\`.`, ephemeral: true });
      }

      // Check current status update to auto-unlock any missed quest triggers
      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        await checkAndAwardQuests(player, interaction.guild, member);
        await player.save();
      }

      const embed = new EmbedBuilder()
        .setTitle(`📜 Quests & Achievements — ${player.username}`)
        .setColor(0x9b59b6)
        .setDescription('Complete milestones to earn bonus MMR rewards!');

      for (const quest of QUESTS) {
        const isCompleted = player.completedQuests.includes(quest.id);
        let progressText = '';

        if (quest.type === 'total_kills') {
          progressText = `Progress: ${Math.min(player.kills, quest.goal)}/${quest.goal} Kills`;
        } else if (quest.type === 'total_deaths') {
          progressText = `Progress: ${Math.min(player.deaths, quest.goal)}/${quest.goal} Deaths`;
        } else if (quest.type === 'rank') {
          progressText = `Requirement: Reach ${quest.minMmr} MMR`;
        }

        const statusIcon = isCompleted ? '✅ **COMPLETED**' : `⏳ *In Progress* (${progressText})`;
        embed.addFields({
          name: `${quest.title} (+${quest.rewardMmr} MMR)`,
          value: `${quest.description}\n${statusIcon}`,
          inline: false
        });
      }

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'addmmr') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      const target = interaction.options.getUser('target');
      const amount = interaction.options.getNumber('amount');

      let player = await Player.findOne({ userId: target.id }) || new Player({ userId: target.id, username: target.username });
      player.mmr += amount;
      await checkAndAwardQuests(player, interaction.guild, interaction.member);
      await player.save();

      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        await updatePlayerRole(interaction.guild, member, player.mmr);
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
        await updatePlayerRole(interaction.guild, member, player.mmr);
      }
      return interaction.reply({ content: `✅ Deducted **-${amount} MMR** from <@${target.id}>. New MMR: **${player.mmr.toFixed(0)}**` });
    }

    if (interaction.commandName === 'setmmr') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      const target = interaction.options.getUser('target');
      const value = interaction.options.getNumber('value');

      let player = await Player.findOne({ userId: target.id }) || new Player({ userId: target.id, username: target.username });
      player.mmr = Math.max(0, value);
      await checkAndAwardQuests(player, interaction.guild, interaction.member);
      await player.save();

      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        await updatePlayerRole(interaction.guild, member, player.mmr);
      }
      return interaction.reply({ content: `✅ Set <@${target.id}>'s MMR to **${player.mmr.toFixed(0)}**.` });
    }

    if (interaction.commandName === 'clearallmmr') {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      await Player.deleteMany({});
      if (interaction.guild) {
        await refreshChampionRole(interaction.guild);
      }
      return interaction.reply({ content: "⚠️ **Database Wiped:** All MMR records and player profiles have been reset." });
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

    if (interaction.customId.startsWith('approve_reject_')) {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      const channelId = interaction.customId.split('_')[2];

      const rejectedEmbed = new EmbedBuilder()
        .setTitle('❌ Match Submission Rejected')
        .setColor(0xe74c3c)
        .setDescription(`Rejected by staff <@${interaction.user.id}>.`);

      await interaction.update({ embeds: [rejectedEmbed], components: [] });

      const sourceChannel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (sourceChannel) {
        await sourceChannel.send('❌ Your match submission was rejected by staff.');
      }

      await interaction.message.delete().catch(() => {});
    }

    if (interaction.customId.startsWith('thread_win_')) {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      const [, , winnerId, loserId, channelId] = interaction.customId.split('_');

      const modal = new ModalBuilder()
        .setCustomId(`submit_thread_stats_${winnerId}_${loserId}_${channelId}`)
        .setTitle('Grade Match Thread Stats');

      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('winner_kills').setLabel('Winner Kills').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('winner_deaths').setLabel('Winner Deaths').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('loser_kills').setLabel('Loser Kills').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('loser_deaths').setLabel('Loser Deaths').setStyle(TextInputStyle.Short).setRequired(true))
      );

      await interaction.showModal(modal);
    }

    if (interaction.customId.startsWith('pub_win_')) {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      const [, , submitterId, channelId] = interaction.customId.split('_');

      const modal = new ModalBuilder()
        .setCustomId(`submit_pub_stats_${submitterId}_${channelId}_win`)
        .setTitle('Pub Match Win Stats');

      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kills').setLabel('Your Kills').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deaths').setLabel('Your Deaths').setStyle(TextInputStyle.Short).setRequired(true))
      );

      await interaction.showModal(modal);
    }

    if (interaction.customId.startsWith('pub_lose_')) {
      if (!isStaff(interaction.member)) return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      const [, , submitterId, channelId] = interaction.customId.split('_');

      const modal = new ModalBuilder()
        .setCustomId(`submit_pub_stats_${submitterId}_${channelId}_lose`)
        .setTitle('Pub Match Loss Stats');

      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kills').setLabel('Your Kills').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deaths').setLabel('Your Deaths').setStyle(TextInputStyle.Short).setRequired(true))
      );

      await interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('submit_thread_stats_')) {
      const [, , winnerId, loserId, channelId] = interaction.customId.split('_');

      const winnerKills = parseInt(interaction.fields.getTextInputValue('winner_kills'), 10) || 0;
      const winnerDeaths = parseInt(interaction.fields.getTextInputValue('winner_deaths'), 10) || 0;
      const loserKills = parseInt(interaction.fields.getTextInputValue('loser_kills'), 10) || 0;
      const loserDeaths = parseInt(interaction.fields.getTextInputValue('loser_deaths'), 10) || 0;

      await interaction.deferReply();

      // Winner Stats update
      let winner = await Player.findOne({ userId: winnerId }) || new Player({ userId: winnerId });
      let winnerMmrGain = 7.5 + (winnerKills * 0.20) - (winnerDeaths * 0.25);
      winner.wins += 1;
      winner.kills += winnerKills;
      winner.deaths += winnerDeaths;
      winner.mmr = Math.max(0, winner.mmr + winnerMmrGain);

      const winMember = interaction.guild ? await interaction.guild.members.fetch(winnerId).catch(() => null) : null;
      await checkAndAwardQuests(winner, interaction.guild, winMember);
      await winner.save();

      // Loser Stats update
      let loser = await Player.findOne({ userId: loserId }) || new Player({ userId: loserId });
      let loserMmrLoss = -10 + (loserKills * 0.20) - (loserDeaths * 0.25);
      loser.losses += 1;
      loser.kills += loserKills;
      loser.deaths += loserDeaths;
      loser.mmr = Math.max(0, loser.mmr + loserMmrLoss);

      const loseMember = interaction.guild ? await interaction.guild.members.fetch(loserId).catch(() => null) : null;
      await checkAndAwardQuests(loser, interaction.guild, loseMember);
      await loser.save();

      if (interaction.guild) {
        await updatePlayerRole(interaction.guild, winMember, winner.mmr);
        await updatePlayerRole(interaction.guild, loseMember, loser.mmr);
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('✅ Thread Match Approved & Saved')
        .setColor(0x2ecc71)
        .setDescription(
          `**Grader:** <@${interaction.user.id}>\n\n` +
          `👑 **Winner:** <@${winnerId}> (+${winnerMmrGain.toFixed(1)} MMR → **${winner.mmr.toFixed(0)}**)\n` +
          `💀 **Loser:** <@${loserId}> (${loserMmrLoss.toFixed(1)} MMR → **${loser.mmr.toFixed(0)}**)\n\n` +
          `📊 **Stats:** Winner (${winnerKills}K / ${winnerDeaths}D) | Loser (${loserKills}K / ${loserDeaths}D)`
        );

      await interaction.editReply({ embeds: [resultEmbed] });

      const sourceChannel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (sourceChannel) {
        await sourceChannel.send({ embeds: [resultEmbed] });
        if (sourceChannel.isThread()) {
          await sourceChannel.setArchived(true).catch(() => null);
        }
      }

      await interaction.message.delete().catch(() => {});
    }

    if (interaction.customId.startsWith('submit_pub_stats_')) {
      const parts = interaction.customId.split('_');
      const submitterId = parts[3];
      const channelId = parts[4];
      const outcome = parts[5]; 

      const kills = parseInt(interaction.fields.getTextInputValue('kills'), 10) || 0;
      const deaths = parseInt(interaction.fields.getTextInputValue('deaths'), 10) || 0;

      await interaction.deferReply();

      let player = await Player.findOne({ userId: submitterId }) || new Player({ userId: submitterId });
      let mmrChange = 0;

      if (outcome === 'win') {
        mmrChange = 7.5 + (kills * 0.20) - (deaths * 0.25);
        player.wins += 1;
        player.mmr = Math.max(0, player.mmr + mmrChange);
      } else {
        mmrChange = -10 + (deaths * 0.20) - (kills * 0.25);
        player.losses += 1;
        player.mmr = Math.max(0, player.mmr + mmrChange);
      }

      player.kills += kills;
      player.deaths += deaths;

      const member = interaction.guild ? await interaction.guild.members.fetch(submitterId).catch(() => null) : null;
      await checkAndAwardQuests(player, interaction.guild, member);
      await player.save();

      if (interaction.guild) {
        await updatePlayerRole(interaction.guild, member, player.mmr);
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle(outcome === 'win' ? '✅ Pub Match Approved (Win)' : '⚠️ Pub Match Recorded (Loss)')
        .setColor(outcome === 'win' ? 0x2ecc71 : 0xe74c3c)
        .setDescription(
          `**Grader:** <@${interaction.user.id}>\n` +
          `**Player:** <@${submitterId}>\n` +
          `**MMR Change:** ${mmrChange >= 0 ? '+' : ''}${mmrChange.toFixed(1)} MMR → **${player.mmr.toFixed(0)}**\n` +
          `📊 **Stats:** ${kills} Kills / ${deaths} Deaths`
        );

      await interaction.editReply({ embeds: [resultEmbed] });

      const sourceChannel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (sourceChannel) {
        await sourceChannel.send({ embeds: [resultEmbed] });
      }

      await interaction.message.delete().catch(() => {});
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

  const thread = await channel.threads.create({
    name: `⚔️ 1v1 Arena Match - Code ${roomCode}`,
    autoArchiveDuration: 60
  });

  const p1 = players[0];
  const p2 = players[1];

  matchPlayersCache.set(thread.id, [p1.userId, p2.userId]);

  const embed = new EmbedBuilder()
    .setTitle(`🏟️ 1v1 Arena Match Started`)
    .setColor(0x2ecc71)
    .setDescription(
      `🔑 **Private Room Code:** \`${roomCode}\`\n\n` +
      `👤 **Player 1:** <@${p1.userId}>\n` +
      `👤 **Player 2:** <@${p2.userId}>\n\n` +
      `**Instructions:**\n` +
      `1. Join Animal Company using code **${roomCode}**.\n` +
      `2. Upload screenshot in this thread.\n` +
      `3. Staff will review and grade both players in <#${APPROVAL_CHANNEL_ID}>.\n\n` +
      `⏳ *This thread will automatically delete in 1 hour.*`
    );

  await thread.send({ 
    content: `<@${p1.userId}> vs <@${p2.userId}>`, 
    embeds: [embed]
  });

  setTimeout(async () => {
    try {
      matchPlayersCache.delete(thread.id);
      if (!thread.deleted) {
        await thread.delete('Match thread expired after 1 hour.');
      }
    } catch (err) {
      console.error(`Failed to auto-delete thread ${thread.id}:`, err);
    }
  }, 3600000);
}

http.createServer((req, res) => res.end('Bot active')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
