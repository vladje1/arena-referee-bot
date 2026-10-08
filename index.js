require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
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

// --- 🛠 BOT HELPER FUNCTIONS ---
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
  if (!interaction.isChatInputCommand()) return;

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
});

http.createServer((req, res) => res.end('Bot active')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
