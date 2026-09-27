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
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const mongoose = require('mongoose');
const { InferenceClient } = require('@huggingface/inference');
const http = require('http');

const hf = new InferenceClient(process.env.HF_TOKEN);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// --- ⚙️ AUTOMATED CHANNELS CONFIGURATION ---
const UPLOAD_CHANNEL_ID = '1553172302420643950'; 
const REVIEW_CHANNEL_ID = '1553177031523700838'; 
// -------------------------------------------

// --- 🛡️ ROLE SECURITY SETTINGS ---
const STAFF_ROLE_ID = '1553324535128916070'; 
// ----------------------------------

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

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected securely to Cloud Leaderboard Database!'))
  .catch(err => console.error('Database connection tracking failed:', err));

// --- 🛠️ HELPER FUNCTIONS ---
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

async function analyzeScoreboardWithAI(imageUrl) {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://render.com",
        "X-Title": "Arena Ranked Bot",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Look closely at the small watch screen in the VR image.\n\n1. OUTCOME: Check HP display at top. Above 0 HP = 'win', otherwise 'loss'.\n2. KILLS (K): Read top number next to 'K'.\n3. DEATHS (D): Read bottom number next to 'D'. COUNT DIGITS CAREFULLY. If only 1 character is visible (like '2'), output 2. Do not output two digits unless clearly side-by-side.\n\nReturn raw JSON only: {\"outcome\": \"win\", \"kills\": 21, \"deaths\": 2}"
              },
              {
                type: "image_url",
                image_url: { url: imageUrl }
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (!data?.choices?.[0]?.message) return null;

    const jsonMatch = data.choices[0].message.content.match(/\{[\s\S]*?\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (err) {
    console.error("AI Scanning Error:", err);
    return null;
  }
}

// --- 🎮 BOT READY EVENT ---
client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

// --- 🎛️ INTERACTION HANDLER (Commands, Buttons, Modals) ---
client.on('interactionCreate', async (interaction) => {

  // 1. Slash Commands Handling
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'leaderboard') {
      const sorted = await Player.find({}).sort({ mmr: -1 }).limit(10);
      if (sorted.length === 0) return interaction.reply({ content: "The leaderboard is empty!", ephemeral: true });
      
      let text = `🥇 **Animal Company Arena Leaderboard** 🥇\n\n`;
      sorted.forEach((p, i) => {
        text += `${i + 1}. **${p.username}** — [${getRankInfo(p.mmr).name}] ${p.mmr.toFixed(0)} MMR\n`;
      });
      return interaction.reply({ content: text });
    }

    if (['addmmr', 'removemmr', 'setmmr', 'clearallmmr'].includes(commandName)) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ Access Denied: Requires Staff status.", ephemeral: true });
      }
    }

    if (commandName === 'addmmr') {
      const targetUser = interaction.options.getUser('player');
      const amount = interaction.options.getNumber('amount');
      if (amount <= 0) return interaction.reply({ content: "⚠️ Amount must be greater than 0.", ephemeral: true });

      let player = await Player.findOne({ userId: targetUser.id }) || new Player({ userId: targetUser.id, username: targetUser.username });
      player.mmr += amount;
      await player.save();

      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        await updatePlayerRole(interaction.guild, member, player.mmr);
      }
      return interaction.reply({ content: `✅ Added **${amount} MMR** to **${targetUser.username}**! (New Total: ${player.mmr.toFixed(2)})` });
    }

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
      return interaction.reply({ content: `✅ Removed **${amount} MMR** from **${targetUser.username}**! (New Total: ${player.mmr.toFixed(2)})` });
    }

    if (commandName === 'setmmr') {
      const targetUser = interaction.options.getUser('player');
      const amount = interaction.options.getNumber('amount');
      if (amount < 0) return interaction.reply({ content: "⚠️ MMR cannot be lower than 0.", ephemeral: true });

      let player = await Player.findOne({ userId: targetUser.id }) || new Player({ userId: targetUser.id, username: targetUser.username });
      player.mmr = amount;
      await player.save();

      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        await updatePlayerRole(interaction.guild, member, player.mmr);
      }
      return interaction.reply({ content: `🎯 Set **${targetUser.username}** to **${amount} MMR** [${getRankInfo(amount).name}].` });
    }

    if (commandName === 'clearallmmr') {
      await Player.deleteMany({});
      return interaction.reply({ content: "🧹 Leaderboard Wiped! Ledger permanently cleared." });
    }
  }

  // 2. Buttons Handling
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('report_match_')) {
      const modal = new ModalBuilder()
        .setCustomId(`submit_dispute_${interaction.message.id}`)
        .setTitle('Dispute AI Match Stats');

      const killsInput = new TextInputBuilder()
        .setCustomId('correct_kills')
        .setLabel('Correct Kills')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter actual kills')
        .setRequired(true);

      const deathsInput = new TextInputBuilder()
        .setCustomId('correct_deaths')
        .setLabel('Correct Deaths')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter actual deaths')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(killsInput),
        new ActionRowBuilder().addComponents(deathsInput)
      );

      await interaction.showModal(modal);
      return;
    }

    const [action, outcome, playerId] = interaction.customId.split('_');

    if (action === 'deny') {
      await interaction.message.delete().catch(() => null);
      return interaction.reply({ content: '❌ Match submission rejected and cleared.', ephemeral: true });
    }

    if (action === 'manual' || action === 'openform') {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ You don't have the Staff role to grade matches.", ephemeral: true });
      }
      const modal = new ModalBuilder()
        .setCustomId(`statsmodal_${outcome}_${playerId}`)
        .setTitle('Enter Match Statistics');

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
      return;
    }
  }

  // 3. Modal Submission Handling
  if (interaction.isModalSubmit()) {
    const [prefix, outcome, playerId] = interaction.customId.split('_');
    if (prefix !== 'statsmodal') return;

    const kills = parseInt(interaction.fields.getTextInputValue('modal_kills'), 10);
    const deaths = parseInt(interaction.fields.getTextInputValue('modal_deaths'), 10);

    if (isNaN(kills) || isNaN(deaths) || kills < 0 || deaths < 0) {
      return interaction.reply({ content: '❌ Error: Invalid numbers entry!', ephemeral: true });
    }

    let player = await Player.findOne({ userId: playerId }) || new Player({ userId: playerId });
    const targetUser = await client.users.fetch(playerId).catch(() => null);
    if (targetUser) player.username = targetUser.username;

    let mmrChange = outcome === 'win' ? 7.5 : -10;
    if (outcome === 'win') player.wins += 1; else player.losses += 1;

    const cleanKills = Number(kills) || 0;
    const cleanDeaths = Number(deaths) || 0;

    mmrChange += (cleanKills * 0.20);
    mmrChange -= (cleanDeaths * 0.25);

    player.kills += cleanKills;
    player.deaths += cleanDeaths;
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
          `• **Stats:** ${kills} Kills (+${(kills*0.20).toFixed(1)} MMR) | ${deaths} Deaths (-${(deaths*0.25).toFixed(2)} MMR)\n` +
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

// --- 📸 AUTOMATED SCREENSHOT PROCESSOR ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const attachment = message.attachments.first();
  if (!attachment || !attachment.contentType?.startsWith('image/')) return;

  const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
  const aiResult = await analyzeScoreboardWithAI(attachment.url);

  if (aiResult && aiResult.outcome) {
    const { outcome, kills, deaths } = aiResult;
    const cleanKills = parseInt(kills, 10) || 0;
    const cleanDeaths = parseInt(deaths, 10) || 0;
    const cleanOutcome = outcome?.toLowerCase() === 'win' ? 'win' : 'loss';

    let player = await Player.findOne({ userId: message.author.id }) || new Player({ userId: message.author.id, username: message.author.username });
    
    let mmrChange = cleanOutcome === 'win' ? 7.5 : -10;
    if (cleanOutcome === 'win') player.wins += 1; else player.losses += 1;

    mmrChange += (cleanKills * 0.20);
    mmrChange -= (cleanDeaths * 0.25);

    player.kills += cleanKills;
    player.deaths += cleanDeaths;
    player.mmr = Math.max(0, player.mmr + mmrChange);
    await player.save();

    let rankUpdateMessage = '';
    if (message.guild) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      const newRankAssigned = await updatePlayerRole(message.guild, member, player.mmr);
      if (newRankAssigned) {
        rankUpdateMessage = `\n🆕 **Rank Up:** Server role updated to **${newRankAssigned}**!`;
      }
    }

    const reportCardText = `🤖 **Auto-Graded via Vision AI!**\n` +
      `• **Match Result:** ${cleanOutcome === 'win' ? '🟢 WIN' : '🔴 LOSS'}\n` +
      `• **Stats Detected:** ${cleanKills} Kills (+${(cleanKills*0.20).toFixed(1)} MMR) | ${cleanDeaths} Deaths (-${(cleanDeaths*0.25).toFixed(2)} MMR)\n` +
      `• **MMR Delta:** ${mmrChange >= 0 ? '+' : ''}${mmrChange.toFixed(2)}\n` +
      `• **New Total MMR:** ${player.mmr.toFixed(2)} [${getRankInfo(player.mmr).name}]${rankUpdateMessage}`;

    const reportButton = new ButtonBuilder()
      .setCustomId(`report_match_${message.id}`)
      .setLabel('⚠️ Report Wrong Stats')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(reportButton);

    await message.reply({ content: reportCardText, components: [row] }).catch(() => null);
    await message.react('✅').catch(() => null);

    if (reviewChannel) {
      await reviewChannel.send({
        content: `⚡ **Match Auto-Processed by Vision AI**\n👤 **Player:** <@${message.author.id}>\n📊 **Logged:** ${cleanOutcome.toUpperCase()} (${cleanKills}K / ${cleanDeaths}D) | ${mmrChange >= 0 ? '+' : ''}${mmrChange.toFixed(2)} MMR`
      });
    }
  } else {
    // Manual review trigger when AI fails
    const manualWin = new ButtonBuilder()
      .setCustomId(`openform_win_${message.author.id}`)
      .setLabel('Enter Stats (WIN)')
      .setStyle(ButtonStyle.Success);

    const manualLoss = new ButtonBuilder()
      .setCustomId(`openform_loss_${message.author.id}`)
      .setLabel('Enter Stats (LOSS)')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(manualWin, manualLoss);

    const embed = new EmbedBuilder()
      .setTitle('🔍 Manual Review Needed')
      .setColor(0xf1c40f)
      .setDescription('AI could not read the watch clearly. Staff can input stats manually using the buttons below:')
      .setImage(attachment.url);

    await message.reply({ embeds: [embed], components: [row] });
    await message.react('❓').catch(() => null);
  }
});

// --- 🌐 WEB SERVER KEEP-ALIVE & LOGIN ---
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
