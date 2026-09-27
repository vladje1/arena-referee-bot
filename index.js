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
  EmbedBuilder
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

// --- 🗄️ DATABASE SCHEMATIC ---
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
  .then(() => console.log('⚡ Connected securely to Cloud Leaderboard Database!'))
  .catch(err => console.error('❌ Database connection error:', err));

// --- 🛠️ HELPER FUNCTIONS ---
function getRankInfo(mmr) {
  return RANK_ROLES.find(rank => mmr >= rank.minMmr) || RANK_ROLES[RANK_ROLES.length - 1];
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
  if (!member) return false;
  return member.permissions.has('Administrator') || member.roles.cache.has(STAFF_ROLE_ID);
}

// --- 🚀 FIXED & RELIABLE VISION AI FUNCTION ---
async function analyzeScoreboardWithAI(imageUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://render.com",
        "X-Title": "Arena Ranked Bot",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        // 1. Explicitly target a FREE Vision-capable model
        model: "google/gemini-2.0-flash-lite-001:free", 
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Look at the watch screen in this VR screenshot.\n" +
                      "1. HP at top (e.g. 200). If HP > 0, outcome is 'win', else 'loss'.\n" +
                      "2. Kills (K) is the top number next to 'K'.\n" +
                      "3. Deaths (D) is the bottom number next to 'D'.\n\n" +
                      "Respond ONLY with a valid JSON object. No extra text, no markdown formatting. Example: {\"outcome\": \"win\", \"kills\": 19, \"deaths\": 4}"
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

    clearTimeout(timeoutId);
    const data = await response.json();

    if (!data?.choices?.[0]?.message?.content) {
      console.error("AI API returned empty response:", JSON.stringify(data));
      return null;
    }

    const content = data.choices[0].message.content;

    // Clean up response if the model included markdown code blocks
    const cleanedContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonMatch = cleanedContent.match(/\{[\s\S]*?\}/);

    if (!jsonMatch) {
      console.error("Could not parse JSON from AI response:", content);
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("AI Vision Scan Error:", err.message);
    return null;
  }
}

// --- 🎮 BOT READY ---
client.once('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
});

// --- 🎛️ INTERACTION HANDLER ---
client.on('interactionCreate', async (interaction) => {

  // 1. Slash Commands
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'leaderboard') {
      const sorted = await Player.find({}).sort({ mmr: -1 }).limit(10);
      if (sorted.length === 0) return interaction.reply({ content: "❌ The leaderboard is currently empty!", ephemeral: true });
      
      let text = `🥇 **Arena Leaderboard** 🥇\n\n`;
      sorted.forEach((p, i) => {
        text += `${i + 1}. **${p.username}** — [${getRankInfo(p.mmr).name}] ${p.mmr.toFixed(0)} MMR\n`;
      });
      return interaction.reply({ content: text });
    }

    if (['addmmr', 'removemmr', 'setmmr', 'clearallmmr'].includes(commandName)) {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ Access Denied: Staff permissions required.", ephemeral: true });
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
        updatePlayerRole(interaction.guild, member, player.mmr);
      }
      return interaction.reply({ content: `✅ Added **+${amount} MMR** to **${targetUser.username}**! (New MMR: ${player.mmr.toFixed(2)})` });
    }

    if (commandName === 'removemmr') {
      const targetUser = interaction.options.getUser('player');
      const amount = interaction.options.getNumber('amount');
      if (amount <= 0) return interaction.reply({ content: "⚠️ Amount must be greater than 0.", ephemeral: true });

      let player = await Player.findOne({ userId: targetUser.id });
      if (!player) return interaction.reply({ content: `❌ No player record found for ${targetUser.username}.`, ephemeral: true });

      player.mmr = Math.max(0, player.mmr - amount);
      await player.save();

      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        updatePlayerRole(interaction.guild, member, player.mmr);
      }
      return interaction.reply({ content: `✅ Removed **-${amount} MMR** from **${targetUser.username}**! (New MMR: ${player.mmr.toFixed(2)})` });
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
        updatePlayerRole(interaction.guild, member, player.mmr);
      }
      return interaction.reply({ content: `🎯 Set **${targetUser.username}** to **${amount} MMR** [${getRankInfo(amount).name}].` });
    }

    if (commandName === 'clearallmmr') {
      await Player.deleteMany({});
      return interaction.reply({ content: "🧹 Leaderboard successfully reset!" });
    }
  }

  // 2. Button Interactions
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('report_match_')) {
      const modal = new ModalBuilder()
        .setCustomId(`submit_dispute_${interaction.message.id}`)
        .setTitle('Dispute Match Stats');

      const killsInput = new TextInputBuilder()
        .setCustomId('correct_kills')
        .setLabel('Correct Kills')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Actual kills')
        .setRequired(true);

      const deathsInput = new TextInputBuilder()
        .setCustomId('correct_deaths')
        .setLabel('Correct Deaths')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Actual deaths')
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
      return interaction.reply({ content: '❌ Submission cleared.', ephemeral: true });
    }

    if (action === 'openform') {
      if (!isStaff(interaction.member)) {
        return interaction.reply({ content: "❌ Staff permissions required.", ephemeral: true });
      }
      const modal = new ModalBuilder()
        .setCustomId(`statsmodal_${outcome}_${playerId}`)
        .setTitle('Enter Match Statistics');

      const killsInput = new TextInputBuilder()
        .setCustomId('modal_kills')
        .setLabel('Kills')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const deathsInput = new TextInputBuilder()
        .setCustomId('modal_deaths')
        .setLabel('Deaths')
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

  // 3. Modal Submission
  if (interaction.isModalSubmit()) {
    const [prefix, outcome, playerId] = interaction.customId.split('_');

    if (prefix === 'submit_dispute') {
      await interaction.reply({ content: '⚠️ Dispute submitted to staff for manual review!', ephemeral: true });
      const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
      if (reviewChannel) {
        const k = interaction.fields.getTextInputValue('correct_kills');
        const d = interaction.fields.getTextInputValue('correct_deaths');
        await reviewChannel.send(`<@&${STAFF_ROLE_ID}> ⚠️ **Match Disputed by <@${interaction.user.id}>**\nClaimed Stats: ${k} Kills / ${d} Deaths`);
      }
      return;
    }

    if (prefix === 'statsmodal') {
      const kills = parseInt(interaction.fields.getTextInputValue('modal_kills'), 10);
      const deaths = parseInt(interaction.fields.getTextInputValue('modal_deaths'), 10);

      if (isNaN(kills) || isNaN(deaths) || kills < 0 || deaths < 0) {
        return interaction.reply({ content: '❌ Invalid numbers entered!', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      let player = await Player.findOne({ userId: playerId }) || new Player({ userId: playerId });
      const targetUser = await client.users.fetch(playerId).catch(() => null);
      if (targetUser) player.username = targetUser.username;

      let mmrChange = outcome === 'win' ? 7.5 : -10;
      if (outcome === 'win') player.wins += 1; else player.losses += 1;

      mmrChange += (kills * 0.20) - (deaths * 0.25);
      player.kills += kills;
      player.deaths += deaths;
      player.mmr = Math.max(0, player.mmr + mmrChange);

      let rankUpdateMessage = '';
      if (interaction.guild) {
        const member = await interaction.guild.members.fetch(playerId).catch(() => null);
        const newRank = await updatePlayerRole(interaction.guild, member, player.mmr);
        if (newRank) rankUpdateMessage = `\n🆕 **Rank Changed:** Updated to **${newRank}**!`;
      }

      await player.save();

      await interaction.message.edit({
        content: `✅ **Graded by Staff:** ${interaction.user.username}\n👤 **Player:** <@${playerId}>\n📊 **Stats:** ${outcome.toUpperCase()} (${kills}K / ${deaths}D)\n⭐ **MMR Change:** ${mmrChange >= 0 ? '+' : ''}${mmrChange.toFixed(2)} (Total: ${player.mmr.toFixed(2)})${rankUpdateMessage}`,
        components: []
      });

      await interaction.editReply({ content: '✅ Match successfully logged!' });
    }
  }
});

// --- 📸 AUTOMATED SCREENSHOT PROCESSOR ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const attachment = message.attachments.first();
  if (!attachment || !attachment.contentType?.startsWith('image/')) return;

  const processingEmoji = await message.react('⏳').catch(() => null);

  const [reviewChannel, aiResult] = await Promise.all([
    client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null),
    analyzeScoreboardWithAI(attachment.url)
  ]);

  if (processingEmoji) await message.reactions.cache.get('⏳')?.users.remove(client.user.id).catch(() => null);

  if (aiResult && aiResult.outcome) {
    const { outcome, kills, deaths } = aiResult;
    const cleanKills = parseInt(kills, 10) || 0;
    const cleanDeaths = parseInt(deaths, 10) || 0;
    const cleanOutcome = outcome?.toLowerCase() === 'win' ? 'win' : 'loss';

    let player = await Player.findOne({ userId: message.author.id }) || new Player({ userId: message.author.id, username: message.author.username });
    
    let mmrChange = cleanOutcome === 'win' ? 7.5 : -10;
    if (cleanOutcome === 'win') player.wins += 1; else player.losses += 1;

    mmrChange += (cleanKills * 0.20) - (cleanDeaths * 0.25);
    player.kills += cleanKills;
    player.deaths += cleanDeaths;
    player.mmr = Math.max(0, player.mmr + mmrChange);

    let rankUpdateMessage = '';
    if (message.guild) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      const newRank = await updatePlayerRole(message.guild, member, player.mmr);
      if (newRank) rankUpdateMessage = `\n🆕 **Rank Up:** Server role updated to **${newRank}**!`;
    }

    await player.save();

    const reportCardText = `🤖 **Auto-Graded via Vision AI**\n` +
      `• **Outcome:** ${cleanOutcome === 'win' ? '🟢 WIN' : '🔴 LOSS'}\n` +
      `• **Stats:** ${cleanKills} Kills (+${(cleanKills * 0.20).toFixed(1)}) | ${cleanDeaths} Deaths (-${(cleanDeaths * 0.25).toFixed(2)})\n` +
      `• **MMR Delta:** ${mmrChange >= 0 ? '+' : ''}${mmrChange.toFixed(2)}\n` +
      `• **New MMR:** ${player.mmr.toFixed(2)} [${getRankInfo(player.mmr).name}]${rankUpdateMessage}`;

    const reportButton = new ButtonBuilder()
      .setCustomId(`report_match_${message.id}`)
      .setLabel('⚠️ Report Wrong Stats')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(reportButton);

    await Promise.all([
      message.reply({ content: reportCardText, components: [row] }),
      message.react('✅')
    ]).catch(() => null);

    if (reviewChannel) {
      reviewChannel.send({
        content: `⚡ **Auto-Processed Match**\n👤 **Player:** <@${message.author.id}>\n📊 **Logged:** ${cleanOutcome.toUpperCase()} (${cleanKills}K / ${cleanDeaths}D) | ${mmrChange >= 0 ? '+' : ''}${mmrChange.toFixed(2)} MMR`
      }).catch(() => null);
    }
  } else {
    // AI failed — send review request to the review channel with staff ping
    const manualWin = new ButtonBuilder()
      .setCustomId(`openform_win_${message.author.id}`)
      .setLabel('Enter Stats (WIN)')
      .setStyle(ButtonStyle.Success);

    const manualLoss = new ButtonBuilder()
      .setCustomId(`openform_loss_${message.author.id}`)
      .setLabel('Enter Stats (LOSS)')
      .setStyle(ButtonStyle.Secondary);

    const denyButton = new ButtonBuilder()
      .setCustomId(`deny_none_${message.author.id}`)
      .setLabel('Reject Match')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(manualWin, manualLoss, denyButton);

    const embed = new EmbedBuilder()
      .setTitle('🔍 Manual Review Required')
      .setColor(0xf1c40f)
      .setDescription(`Player <@${message.author.id}> submitted a screenshot that AI could not read cleanly.\n\nPlease review the image below and select an option:`)
      .setImage(attachment.url);

    // Reply to player in the upload channel
    await Promise.all([
      message.reply('❌ AI could not process this image clearly. Sent to staff for review!'),
      message.react('❌')
    ]).catch(() => null);

    // Send the review card with staff role ping to review channel
    if (reviewChannel) {
      await reviewChannel.send({
        content: `<@&${STAFF_ROLE_ID}> ⚠️ **Manual Review Requested**`,
        embeds: [embed],
        components: [row]
      }).catch(() => null);
    }
  }
});

// --- 🌐 WEB SERVER & LOGIN ---
http.createServer((req, res) => res.end('Bot active')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
