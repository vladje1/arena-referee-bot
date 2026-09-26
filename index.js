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
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const mongoose = require('mongoose');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// --- ⚙️ AUTOMATED CHANNELS CONFIGURATION ---
const UPLOAD_CHANNEL_ID = '1553172302420643950'; // Player screenshot upload channel
const REVIEW_CHANNEL_ID = '1553177031523700838'; // Private staff approval channel
// -------------------------------------------

// --- 🛡️ ROLE SECURITY SETTINGS ---
const STAFF_ROLE_ID = '1553324535128916070'; // Staff Role ID
// ----------------------------------

// --- 📊 COMPETITIVE RANK ROLES ---
const RANK_ROLES = [
  { name: 'Sapphire', minMmr: 20000, id: '1553330980515741706' },
  { name: 'Ruby',     minMmr: 10000, id: '1553330712613093448' },
  { name: 'Emerald',  minMmr: 5000,  id: '1553330578298773534' },
  { name: 'Diamond',  minMmr: 1000,  id: '1553330139578769499' },
  { name: 'Platinum', minMmr: 500,   id: '1553330336795070575' },
  { name: 'Gold',     minMmr: 250,   id: '1553330034943463505' },
  { name: 'Silver',   minMmr: 100,   id: '1553329893687697418' },
  { name: 'Bronze',   minMmr: 0,     id: '1553329700749705226' }
];

// --- 🗄️ CLOUD DATABASE SCHEMATIC DATA MODEL ---
const playerSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, default: 'Player' },
  mmr: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  kills: { type: Number, default: 0 },
  deaths: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

// Connect securely to your Cloud DB Cluster
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected securely to Cloud Leaderboard Database!'))
  .catch(err => console.error('Database connection tracking failed:', err));

function getRankInfo(mmr) {
  return RANK_ROLES.find(rank => mmr >= rank.minMmr) || RANK_ROLES[RANK_ROLES.length - 1];
}

async function updatePlayerRole(guild, member, currentMmr) {
  if (!member) return null;
  const targetRank = getRankInfo(currentMmr);
  const rolesToRemove = RANK_ROLES.filter(rank => rank.id !== targetRank.id && member.roles.cache.has(rank.id));
  
  for (const rank of rolesToRemove) {
    await member.roles.remove(rank.id).catch(() => null);
  }
  
  if (!member.roles.cache.has(targetRank.id)) {
    await member.roles.add(targetRank.id).catch(() => null);
    return targetRank.name;
  }
  return null;
}

function isStaff(member) {
  if (!member) return false;
  return member.permissions.has('Administrator') || member.roles.cache.has(STAFF_ROLE_ID);
}

// --- 🚀 DEPLOY SELECTABLE SLASH COMMANDS ---
const commands = [
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription("View an Arena match record dossier profile.")
    .addUserOption(option => option.setName('user').setDescription('Select a player to view (leave blank for your own stats)').setRequired(false)),
    
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription("Display the top 10 players currently leading the Arena standings."),

  new SlashCommandBuilder()
    .setName('addmmr')
    .setDescription("⛔ Staff Only: Manually add a specific amount of MMR to a player.")
    .addUserOption(option => option.setName('player').setDescription('The target player').setRequired(true))
    .addNumberOption(option => option.setName('amount').setDescription('MMR amount to give').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removemmr')
    .setDescription("⛔ Staff Only: Deduct a specific amount of MMR from a player.")
    .addUserOption(option => option.setName('player').setDescription('The target player').setRequired(true))
    .addNumberOption(option => option.setName('amount').setDescription('MMR amount to remove').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setmmr')
    .setDescription("⛔ Staff Only: Override a player's MMR value to an exact number.")
    .addUserOption(option => option.setName('player').setDescription('The target player').setRequired(true))
    .addNumberOption(option => option.setName('amount').setDescription('The exact MMR score to apply').setRequired(true)),
    
  new SlashCommandBuilder()
    .setName('clearallmmr')
    .setDescription("⛔ Staff Only: Permanently wipe the competitive leaderboard database.")
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log('Deploying selectable slash commands to Discord...');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log('Selectable slash commands successfully deployed!');
    console.log('Uncheatable Arena Referee Bot is online!');
  } catch (error) {
    console.error('Error deploying slash commands:', error);
  }
});

// --- 💬 CHAT INPUT INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Command: /stats
  if (commandName === 'stats') {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const player = await Player.findOne({ userId: targetUser.id });
    
    if (!player) {
      const errorMsg = targetUser.id === interaction.user.id 
        ? "❌ You haven't played any Arena matches yet!" 
        : `❌ **${targetUser.username}** doesn't have any recorded Arena statistics yet.`;
      return interaction.reply({ content: errorMsg, ephemeral: true });
    }

    const totalGames = player.wins + player.losses;
    const winRate = totalGames > 0 ? ((player.wins / totalGames) * 100).toFixed(1) : 0;
    const kdRatio = player.deaths > 0 ? (player.kills / player.deaths).toFixed(2) : player.kills.toFixed(2);
    
    return interaction.reply({
      content: `📊 **${targetUser.username}'s Arena Dossier**\n` +
               `• Current Rank: **${getRankInfo(player.mmr).name}** (${player.mmr.toFixed(2)} MMR)\n` +
               `• K/D Ratio: **${kdRatio}** (${player.kills} Kills / ${player.deaths} Deaths)\n` +
               `• Win Rate: **${winRate}%** (${player.wins}W - ${player.losses}L)`
    });
  }

  // Command: /leaderboard
  if (commandName === 'leaderboard') {
    const sorted = await Player.find({}).sort({ mmr: -1 }).limit(10);
    if (sorted.length === 0) return interaction.reply({ content: "The leaderboard is empty!", ephemeral: true });
    
    let text = `🥇 **Animal Company Arena Leaderboard** 🥇\n\n`;
    sorted.forEach((p, i) => {
      text += `${i + 1}. **${p.username}** — [${getRankInfo(p.mmr).name}] ${p.mmr.toFixed(0)} MMR\n`;
    });
    return interaction.reply({ content: text });
  }

  // Check management command permissions
  if (['addmmr', 'removemmr', 'setmmr', 'clearallmmr'].includes(commandName)) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({ content: "❌ Access Denied: Requires Staff status.", ephemeral: true });
    }
  }

  // Command: /addmmr
  if (commandName === 'addmmr') {
    const targetUser = interaction.options.getUser('player');
    const amount = interaction.options.getNumber('amount');

    if (amount <= 0) return interaction.reply({ content: "⚠️ Amount must be greater than 0.", ephemeral: true });

    let player = await Player.findOne({ userId: targetUser.id });
    if (!player) {
      player = new Player({ userId: targetUser.id, username: targetUser.username });
    }
    
    player.mmr += amount;
    await player.save();

    if (interaction.guild) {
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      await updatePlayerRole(interaction.guild, member, player.mmr);
    }

    return interaction.reply({ content: `✅ Successfully added **${amount} MMR** to **${targetUser.username}**! (New Total: ${player.mmr.toFixed(2)})` });
  }

  // Command: /removemmr
  if (commandName === 'removemmr') {
    const targetUser = interaction.options.getUser('player');
    const amount = interaction.options.getNumber('amount');

    if (amount <= 0) return interaction.reply({ content: "⚠️ Amount must be greater than 0.", ephemeral: true });
    
    let player = await Player.findOne({ userId: targetUser.id });
    if (!player) return interaction.reply({ content: `❌ ${targetUser.username} has no recorded data.`, ephemeral: true });

    player.mmr = Math.max(0, player.mmr - amount);
    await player.save();

    if (interaction.guild) {
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      await updatePlayerRole(interaction.guild, member, player.mmr);
    }

    return interaction.reply({ content: `✅ Successfully removed **${amount} MMR** from **${targetUser.username}**! (New Total: ${player.mmr.toFixed(2)})` });
  }

  // Command: /setmmr
  if (commandName === 'setmmr') {
    const targetUser = interaction.options.getUser('player');
    const amount = interaction.options.getNumber('amount');

    if (amount < 0) return interaction.reply({ content: "⚠️ MMR cannot be lower than 0.", ephemeral: true });

    let player = await Player.findOne({ userId: targetUser.id });
    if (!player) {
      player = new Player({ userId: targetUser.id, username: targetUser.username });
    }

    player.mmr = amount;
    await player.save();

    if (interaction.guild) {
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      await updatePlayerRole(interaction.guild, member, player.mmr);
    }

    return interaction.reply({ content: `🎯 Override successful! **${targetUser.username}** has been set to exactly **${amount} MMR** [${getRankInfo(amount).name}].` });
  }

  // Command: /clearallmmr
  if (commandName === 'clearallmmr') {
    await Player.deleteMany({});
    return interaction.reply({ content: "🧹 **Leaderboard Wiped!** Ledger permanently cleared." });
  }
});

// --- 📸 SCREENSHOT UPLOADS ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.attachments.size > 0 && message.channel.id === UPLOAD_CHANNEL_ID) {
    const attachment = message.attachments.first();
    if (!attachment.contentType?.startsWith('image/')) return;

    const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
    if (!reviewChannel) return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`openform_win_${message.author.id}`).setLabel('🏆 Enter Stats (WIN)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`openform_loss_${message.author.id}`).setLabel('💀 Enter Stats (LOSS)').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`deny_match_${message.author.id}`).setLabel('❌ Reject Image').setStyle(ButtonStyle.Secondary)
    );

    await reviewChannel.send({
      content: `🚨 **New Match Scoreboard Submitted**\n👤 **Player:** <@${message.author.id}> (${message.author.username})\n🔗 **Uploaded Proof:** ${attachment.url}`,
      components: [row]
    });

    await message.react('📥').catch(() => null);
  }
});

// --- 🎛️ BUTTONS & MODAL COMPONENT HANDLING ---
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const [action, outcome, playerId] = interaction.customId.split('_');

    if (action === 'deny') {
      await interaction.message.delete().catch(() => null);
      return interaction.reply({ content: '❌ Match submission rejected and cleared.', ephemeral: true });
    }

    if (action === 'openform') {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ You don't have the Staff role to grade matches.", ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`statsmodal_${outcome}_${playerId}`)
        .setTitle(`Enter Match Statistics`);

      const killsInput = new TextInputBuilder()
        .setCustomId('modal_kills')
        .setLabel('How many KILLS did they get?')
        .setPlaceholder('Example: 40')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const deathsInput = new TextInputBuilder()
        .setCustomId('modal_deaths')
        .setLabel('How many DEATHS did they get?')
        .setPlaceholder('Example: 8')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(killsInput),
        new ActionRowBuilder().addComponents(deathsInput)
      );

      await interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit()) {
    const [prefix, outcome, playerId] = interaction.customId.split('_');
    if (prefix !== 'statsmodal') return;

    const kills = parseInt(interaction.fields.getTextInputValue('modal_kills'), 10);
    const deaths = parseInt(interaction.fields.getTextInputValue('modal_deaths'), 10);

    if (isNaN(kills) || isNaN(deaths) || kills < 0 || deaths < 0) {
      return interaction.reply({ content: '❌ Error: Invalid numbers entry!', ephemeral: true });
    }

    let player = await Player.findOne({ userId: playerId });
    if (!player) {
      player = new Player({ userId: playerId });
    }

    const targetUser = await client.users.fetch(playerId).catch(() => null);
    if (targetUser) player.username = targetUser.username;

    let mmrChange = outcome === 'win' ? 5 : 0;
    if (outcome === 'win') player.wins += 1; else player.losses += 1;
    
    mmrChange += (kills * 0.5) - (deaths * 0.25);
    player.kills += kills;
    player.deaths += deaths;
    player.mmr = Math.max(0, player.mmr + mmrChange);

    await player.save();

    let rankUpdateMessage = '';
    if (interaction.guild) {
      const member = await interaction.guild.members.fetch(playerId).catch(() => null);
      const newRankAssigned = await updatePlayerRole(interaction.guild, member, player.mmr);
      if (newRankAssigned) {
        rankUpdateMessage = `\n🆕 **Rank Changed:** Server role updated to **${newRankAssigned}**!`;
      }
    }

    await interaction.message.edit({ 
      content: `🟩 **Match Approved & Logged by Staff:** ${interaction.user.username}\n👤 **Player:** ${player.username}\n📊 **Stats Applied:** ${outcome.toUpperCase()} (${kills} Kills / ${deaths} Deaths)\n⭐ **MMR Delta:** ${mmrChange >= 0 ? '+' : ''}${mmrChange.toFixed(2)} (Total: ${player.mmr.toFixed(2)})${rankUpdateMessage}`,
      components: [] 
    });

    const uploadChannel = await client.channels.fetch(UPLOAD_CHANNEL_ID).catch(() => null);
    if (uploadChannel) {
      const channelMessages = await uploadChannel.messages.fetch({ limit: 20 }).catch(() => null);
      const originalMessage = channelMessages?.find(m => m.author.id === playerId && m.attachments.size > 0);
      
      if (originalMessage) {
        const reportCardText = `🏆 **Scoreboard Graded by Staff!**\n` +
          `• **Match Result:** ${outcome === 'win' ? '🟢 WIN' : '🔴 LOSS'}\n` +
          `• **Stats:** ${kills} Kills (+${(kills*0.5).toFixed(1)} MMR) | ${deaths} Deaths (-${(deaths*0.25).toFixed(2)} MMR)\n` +
          `• **MMR Delta:** ${mmrChange >= 0 ? '+' : ''}${mmrChange.toFixed(2)}\n` +
          `• **Your New Total MMR:** ${player.mmr.toFixed(2)} [${getRankInfo(player.mmr).name}]${rankUpdateMessage}`;

        await originalMessage.reply(reportCardText).catch(() => null);
        await originalMessage.reactions.removeAll().catch(() => null);
        await originalMessage.react('✅').catch(() => null);
      }
    }

    await interaction.reply({ content: '✅ Match successfully logged and applied!', ephemeral: true });
  }
});

// Fake web server to bypass Render port scan timeout
const http = require('http');
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

client.login(process.env.DISCORD_TOKEN);
