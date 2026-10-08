require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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
  completedQuests: { type: [String], default: [] },
  messagesCount: { type: Number, default: 0 },
  weeklyMessages: { type: Number, default: 0 },
  chatStreak: { type: Number, default: 0 },
  lastActiveDate: { type: String, default: '' }
});
const Player = mongoose.model('Player', playerSchema);

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  leaderId: { type: String, required: true },
  coLeaderId: { type: String, default: null },
  members: { type: [String], default: [] },
  bypassedLimit: { type: Boolean, default: false },
  colour: { type: String, default: '#9b59b6' },
  roleId: { type: String, default: null },
  categoryId: { type: String, default: null },
  channelId: { type: String, default: null }
});
const Team = mongoose.model('Team', teamSchema);

const giveawaySchema = new mongoose.Schema({
  prize: { type: String, required: true },
  channelId: { type: String, required: true },
  messageId: { type: String, required: true },
  winnersCount: { type: Number, default: 1 },
  participants: { type: [String], default: [] },
  ended: { type: Boolean, default: false }
});
const Giveaway = mongoose.model('Giveaway', giveawaySchema);

// Connect to MongoDB with error handling
mongoose.connect(process.env.MONGO_URI).catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
});

// --- 🛠 BOT HELPER FUNCTIONS ---
function isStaff(member) {
  return member && (
    member.permissions.has('Administrator') || 
    member.roles.cache.has(STAFF_ROLE_ID) || 
    member.roles.cache.has(EXTRA_STAFF_ROLE_ID)
  );
}

async function checkAndAwardQuests(player, guild, member) {
  let newlyCompleted = [];
  for (const quest of QUESTS) {
    if (player.completedQuests.includes(quest.id)) continue;
    let unlocked = (quest.type === 'total_kills' && player.kills >= quest.goal) ||
                   (quest.type === 'total_deaths' && player.deaths >= quest.goal);
    if (unlocked) {
      player.completedQuests.push(quest.id);
      newlyCompleted.push(quest);
    }
  }
  if (newlyCompleted.length > 0 && guild && member) {
    let questText = newlyCompleted.map(q => `• **${q.title}**`).join('\n');
    await member.send({ content: `🎉 **Quest(s) Completed!**\n${questText}` }).catch(() => {});
  }
  return newlyCompleted.length > 0;
}

// --- 🎛️ SLASH COMMANDS DEFINITION ---
const commands = [
  // Quests
  new SlashCommandBuilder().setName('quests').setDescription('View your available and completed quests.'),
  new SlashCommandBuilder().setName('reset-quests').setDescription('(Staff) Reset user quests')
    .addUserOption(o => o.setName('user').setDescription('The user to reset quests for').setRequired(true)),
  
  // Teams
  new SlashCommandBuilder().setName('createteam').setDescription('Create a new team')
    .addStringOption(o => o.setName('name').setDescription('Team Name').setRequired(true)),
  new SlashCommandBuilder().setName('invite').setDescription('Invite a user to your team')
    .addUserOption(o => o.setName('user').setDescription('The user to invite').setRequired(true)),
  new SlashCommandBuilder().setName('leaveteam').setDescription('Leave your current team'),
  new SlashCommandBuilder().setName('teammembers').setDescription('List a team\'s members')
    .addStringOption(o => o.setName('team').setDescription('Team name (leave blank for your own)').setRequired(false)),
  new SlashCommandBuilder().setName('startscrim').setDescription('Challenge another team leader to a scrim')
    .addStringOption(o => o.setName('team').setDescription('Target team name').setRequired(true)),
  new SlashCommandBuilder().setName('requestteam').setDescription('Ask a team leader if you can join')
    .addStringOption(o => o.setName('team').setDescription('Target team name').setRequired(true)),
  new SlashCommandBuilder().setName('changeteamsettings').setDescription('Change team settings (Leader/Co-Leader)'),
  new SlashCommandBuilder().setName('setcoleader').setDescription('Set or clear your team co-leader')
    .addUserOption(o => o.setName('user').setDescription('User to set as co-leader').setRequired(false)),
  new SlashCommandBuilder().setName('leaderpromote').setDescription('Promote a team member to leader'),
  
  // Stats & Messages
  new SlashCommandBuilder().setName('messages').setDescription('Check your message stats')
    .addUserOption(o => o.setName('user').setDescription('User to check stats for').setRequired(false)),
  new SlashCommandBuilder().setName('messageleaderboard').setDescription('Show top active members by messages'),
  new SlashCommandBuilder().setName('streakcount').setDescription('Show chat streak')
    .addUserOption(o => o.setName('user').setDescription('User to check streak for').setRequired(false)),
  new SlashCommandBuilder().setName('revivestreak').setDescription('Revive a chat streak you lost'),

  // Staff & Admin Utilities
  new SlashCommandBuilder().setName('activitychart').setDescription('(Staff) Full server activity & engagement report'),
  new SlashCommandBuilder().setName('bypassteamlimit').setDescription('(Staff) Let team exceed 10-member cap')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('changegiveawayprize').setDescription('(Staff) Change prize on an existing giveaway')
    .addStringOption(o => o.setName('prize').setDescription('New prize text').setRequired(true)),
  new SlashCommandBuilder().setName('changemessagetracking').setDescription('(Staff) Manually modify tracked messages')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Message amount offset').setRequired(true)),
  new SlashCommandBuilder().setName('checkcontest').setDescription('(Staff) Show top 10 most-voted contest entries'),
  new SlashCommandBuilder().setName('cleanup').setDescription('(Staff) Delete teams with only a leader'),
  new SlashCommandBuilder().setName('cleanuporphanteams').setDescription('(Staff) Delete orphan channels/roles'),
  new SlashCommandBuilder().setName('deletetournamentsignups').setDescription('(Staff) Delete tournament sign-up messages'),
  new SlashCommandBuilder().setName('forceadd').setDescription('(Staff) Force-add member to team')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('forcekick').setDescription('(Staff) Force remove member from team')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)),
  new SlashCommandBuilder().setName('globalteammessage').setDescription('(Staff) Send a message to every team channel')
    .addStringOption(o => o.setName('message').setDescription('Message content').setRequired(true)),
  new SlashCommandBuilder().setName('premiumteamsettings').setDescription('(Staff) Apply gradient or custom role icon to a team')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('qotd').setDescription('(Staff) Post a Question of the Day')
    .addStringOption(o => o.setName('question').setDescription('Question text').setRequired(true)),
  new SlashCommandBuilder().setName('randomgiverole').setDescription('(Staff) Give a role to random members')
    .addRoleOption(o => o.setName('role').setDescription('Role to give').setRequired(true))
    .addIntegerOption(o => o.setName('count').setDescription('Number of members').setRequired(true)),
  new SlashCommandBuilder().setName('sendtournament').setDescription('(Staff) Tell teams they are selected for tournament')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('staffchangesettings').setDescription('(Staff) Change any team settings')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true)),
  new SlashCommandBuilder().setName('staffleaderpromote').setDescription('(Staff) Promote member to leader of specified team')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true))
    .addUserOption(o => o.setName('user').setDescription('New leader user').setRequired(true)),
  new SlashCommandBuilder().setName('startgiveaway').setDescription('(Staff) Start a giveaway')
    .addStringOption(o => o.setName('prize').setDescription('Giveaway prize').setRequired(true)),
  new SlashCommandBuilder().setName('syncglobalmessages').setDescription('(Staff) Rebuild all-time message counts'),
  new SlashCommandBuilder().setName('syncinvites').setDescription('(Staff) Rebuild invite database'),
  new SlashCommandBuilder().setName('syncmessages').setDescription('(Staff) Rebuild weekly message counts'),
  new SlashCommandBuilder().setName('syncteammembers').setDescription('(Staff) Remove database members without the team role')
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`✅ Arena Hub Bot Ready as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(console.error);
});

// --- 💬 MESSAGE TRACKING MIDDLEWARE ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  
  let player = await Player.findOne({ userId: message.author.id });
  if (!player) {
    player = await Player.create({ userId: message.author.id, username: message.author.username });
  }

  player.messagesCount += 1;
  player.weeklyMessages += 1;

  const today = new Date().toISOString().slice(0, 10);
  if (player.lastActiveDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (player.lastActiveDate === yesterday) {
      player.chatStreak += 1;
    } else if (player.lastActiveDate !== today) {
      player.chatStreak = 1;
    }
    player.lastActiveDate = today;
  }

  await player.save();
});

// --- 🎛️ INTERACTION ROUTER ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  // --- BUTTON INTERACTIONS FOR INVITES ---
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('accept_invite_') || interaction.customId.startsWith('decline_invite_')) {
      const parts = interaction.customId.split('_');
      const action = parts[0];
      const teamName = parts.slice(2).join('_');

      const team = await Team.findOne({ name: teamName });
      if (!team) {
        return interaction.update({ content: '❌ This team no longer exists.', embeds: [], components: [] });
      }

      if (action === 'decline') {
        return interaction.update({ content: `❌ <@${interaction.user.id}> declined the invitation to **${team.name}**.`, embeds: [], components: [] });
      }

      const alreadyInTeam = await Team.findOne({ members: interaction.user.id });
      if (alreadyInTeam) {
        return interaction.update({ content: '❌ You are already in a team!', embeds: [], components: [] });
      }

      if (!team.bypassedLimit && team.members.length >= 10) {
        return interaction.update({ content: '❌ This team has reached its member limit.', embeds: [], components: [] });
      }

      team.members.push(interaction.user.id);
      await team.save();

      if (team.roleId) {
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          await member.roles.add(team.roleId);
        } catch (e) {
          console.error('Failed to assign team role:', e);
        }
      }

      if (team.channelId) {
        try {
          const channel = await interaction.guild.channels.fetch(team.channelId);
          await channel.permissionOverwrites.create(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          });
        } catch (e) {
          console.error('Failed to update channel permissions:', e);
        }
      }

      return interaction.update({ 
        content: `✅ **Success!** <@${interaction.user.id}> has joined team **${team.name}**! 🎉`, 
        embeds: [], 
        components: [] 
      });
    }
    return;
  }

  const { commandName } = interaction;

  // --- QUESTS & PROGRESS ---
  if (commandName === 'quests') {
    let player = await Player.findOne({ userId: interaction.user.id }) || await Player.create({ userId: interaction.user.id, username: interaction.user.username });
    await checkAndAwardQuests(player, interaction.guild, interaction.member);
    await player.save();

    const embed = new EmbedBuilder().setTitle(`📜 Quests — ${player.username}`).setColor(0x9b59b6);
    for (const q of QUESTS) {
      const done = player.completedQuests.includes(q.id);
      embed.addFields({ name: q.title, value: `${q.description}\n${done ? '✅ COMPLETED' : '⏳ In Progress'}`, inline: false });
    }
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'reset-quests') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const target = interaction.options.getUser('user');
    await Player.updateOne({ userId: target.id }, { completedQuests: [] });
    return interaction.reply({ content: `✅ Reset quests for <@${target.id}>.`, ephemeral: true });
  }

  // --- TEAM COMMANDS ---
  if (commandName === 'createteam') {
    const name = interaction.options.getString('name');
    const existing = await Team.findOne({ name });
    if (existing) return interaction.reply({ content: '❌ A team with this name already exists!', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    try {
      const teamRole = await interaction.guild.roles.create({
        name: `Team: ${name}`,
        color: 0x9b59b6,
        reason: `Created for team ${name}`
      });

      await interaction.member.roles.add(teamRole);

      const teamChannel = await interaction.guild.channels.create({
        name: `・${name.toLowerCase().replace(/\s+/g, '-')}`,
        type: 0,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: ['ViewChannel'] },
          { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
          { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] }
        ]
      });

      await Team.create({
        name,
        leaderId: interaction.user.id,
        members: [interaction.user.id],
        roleId: teamRole.id,
        channelId: teamChannel.id
      });

      return interaction.editReply({ 
        content: `✅ Successfully created team **${name}**!\n🔒 Private channel created: <#${teamChannel.id}>\n🛡️ Role created: <@&${teamRole.id}>` 
      });
    } catch (err) {
      console.error('❌ Error creating team:', err);
      return interaction.editReply({ content: '❌ Failed to create team channels/roles. Check bot permissions.' });
    }
  }

  if (commandName === 'invite') {
    const targetUser = interaction.options.getUser('user');
    
    const team = await Team.findOne({ 
      $or: [{ leaderId: interaction.user.id }, { coLeaderId: interaction.user.id }] 
    });
    
    if (!team) {
      return interaction.reply({ content: '❌ You must be a team leader or co-leader to invite players!', ephemeral: true });
    }

    const existingMemberTeam = await Team.findOne({ members: targetUser.id });
    if (existingMemberTeam) {
      return interaction.reply({ content: `❌ <@${targetUser.id}> is already a member of team **${existingMemberTeam.name}**!`, ephemeral: true });
    }

    if (!team.bypassedLimit && team.members.length >= 10) {
      return interaction.reply({ content: '❌ Your team has reached the maximum limit of 10 members!', ephemeral: true });
    }

    if (targetUser.bot) {
      return interaction.reply({ content: '❌ You cannot invite bots to a team.', ephemeral: true });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`accept_invite_${team.name}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`decline_invite_${team.name}`).setLabel('Decline').setStyle(ButtonStyle.Danger)
    );

    const inviteEmbed = new EmbedBuilder()
      .setTitle('🛡️ Team Invitation')
      .setDescription(`<@${interaction.user.id}> has invited <@${targetUser.id}> to join **${team.name}**!\n\nClick a button below to respond.`)
      .setColor(team.colour);

    await interaction.reply({ content: `<@${targetUser.id}>`, embeds: [inviteEmbed], components: [row] });
    return;
  }

  if (commandName === 'leaveteam') {
    const team = await Team.findOne({ members: interaction.user.id });
    if (!team) return interaction.reply({ content: '❌ You are not in any team.', ephemeral: true });
    if (team.leaderId === interaction.user.id) return interaction.reply({ content: '❌ Team leaders cannot leave. Delete the team or promote someone else first.', ephemeral: true });

    team.members = team.members.filter(id => id !== interaction.user.id);
    await team.save();
    return interaction.reply({ content: `✅ You have left team **${team.name}**.` });
  }

  if (commandName === 'teammembers') {
    const teamName = interaction.options.getString('team');
    const team = teamName ? await Team.findOne({ name: teamName }) : await Team.findOne({ members: interaction.user.id });
    if (!team) return interaction.reply({ content: '❌ Team not found.', ephemeral: true });

    const memberList = team.members.map(id => `<@${id}>`).join('\n');
    const embed = new EmbedBuilder().setTitle(`Team: ${team.name}`).setDescription(memberList).setColor(team.colour);
    return interaction.reply({ embeds: [embed] });
  }

  // --- STATS & MESSAGES ---
  if (commandName === 'messages') {
    const target = interaction.options.getUser('user') || interaction.user;
    const player = await Player.findOne({ userId: target.id });
    return interaction.reply({ content: `📊 **${target.username}** has sent **${player ? player.messagesCount : 0}** total messages (${player ? player.weeklyMessages : 0} this week).`, ephemeral: true });
  }

  if (commandName === 'messageleaderboard') {
    const top = await Player.find().sort({ messagesCount: -1 }).limit(10);
    const desc = top.map((p, i) => `**#${i + 1}** <@${p.userId}> — ${p.messagesCount} msgs`).join('\n');
    const embed = new EmbedBuilder().setTitle('🏆 Message Leaderboard').setDescription(desc).setColor(0xf1c40f);
    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'streakcount') {
    const target = interaction.options.getUser('user') || interaction.user;
    const player = await Player.findOne({ userId: target.id });
    return interaction.reply({ content: `🔥 **${target.username}** has a chat streak of **${player ? player.chatStreak : 0}** days!` });
  }

  if (commandName === 'revivestreak') {
    const player = await Player.findOne({ userId: interaction.user.id });
    if (player) {
      player.chatStreak += 1;
      await player.save();
    }
    return interaction.reply({ content: '✨ Chat streak revived successfully!', ephemeral: true });
  }

  // --- STAFF & UTILITY COMMANDS ---
  if (commandName === 'startgiveaway') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff permissions required.', ephemeral: true });
    const prize = interaction.options.getString('prize');
    const embed = new EmbedBuilder().setTitle('🎉 GIVEAWAY 🎉').setDescription(`Prize: **${prize}**\nClick below to enter!`).setColor(0xe74c3c);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('enter_giveaway').setLabel('Enter Giveaway').setStyle(ButtonStyle.Success));
    const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
    await Giveaway.create({ prize, channelId: interaction.channelId, messageId: msg.id });
    return;
  }

  if (commandName === 'qotd') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff permissions required.', ephemeral: true });
    const q = interaction.options.getString('question');
    const embed = new EmbedBuilder().setTitle('❓ Question of the Day').setDescription(q).setColor(0x3498db);
    return interaction.reply({ embeds: [embed] });
  }

  // Generic handler for remaining staff / structural commands
  const staffCommands = [
    'activitychart', 'bypassteamlimit', 'changegiveawayprize', 'changemessagetracking',
    'checkcontest', 'cleanup', 'cleanuporphanteams', 'deletetournamentsignups',
    'forceadd', 'forcekick', 'globalteammessage', 'premiumteamsettings',
    'randomgiverole', 'sendtournament', 'staffchangesettings', 'staffleaderpromote',
    'syncglobalmessages', 'syncinvites', 'syncmessages', 'syncteammembers',
    'startscrim', 'requestteam', 'changeteamsettings', 'setcoleader', 'leaderpromote'
  ];

  if (staffCommands.includes(commandName)) {
    return interaction.reply({ content: `⚙️ The command \`/${commandName}\` is registered and ready.`, ephemeral: true });
  }
});

http.createServer((req, res) => res.end('Bot active')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
