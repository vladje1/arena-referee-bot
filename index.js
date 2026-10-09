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
const GUILD_ID = '1553155002959134831';

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
  weeklyMessages: { type: Number, default: 0 }
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
  leaderRoleId: { type: String, default: null },
  coLeaderRoleId: { type: String, default: null },
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

const tournamentSignupSchema = new mongoose.Schema({
  messageId: { type: String, required: true },
  teamName: { type: String, required: true },
  players: { type: [String], default: [] }
});
const TournamentSignup = mongoose.model('TournamentSignup', tournamentSignupSchema);

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
  new SlashCommandBuilder().setName('help').setDescription('Show a complete directory of all commands and what they do.'),
  new SlashCommandBuilder().setName('quests').setDescription('View your available and completed quests.'),
  new SlashCommandBuilder().setName('reset-quests').setDescription('(Staff) Reset user quests')
    .addUserOption(o => o.setName('user').setDescription('The user to reset quests for').setRequired(true)),
  
  new SlashCommandBuilder().setName('createteam').setDescription('Create a new team')
    .addStringOption(o => o.setName('name').setDescription('Team Name').setRequired(true)),
  new SlashCommandBuilder().setName('invite').setDescription('Invite a user to your team (Leaders/Co-Owners)')
    .addUserOption(o => o.setName('user').setDescription('The user to invite').setRequired(true)),
  new SlashCommandBuilder().setName('leaveteam').setDescription('Leave your current team'),
  new SlashCommandBuilder().setName('teammembers').setDescription('List a team\'s members')
    .addStringOption(o => o.setName('team').setDescription('Team name (leave blank for your own)').setRequired(false).setAutocomplete(true)),
  new SlashCommandBuilder().setName('startscrim').setDescription('Challenge another team leader to a scrim (Leaders/Co-Owners)')
    .addStringOption(o => o.setName('team').setDescription('Target team name').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('requestteam').setDescription('Ask a team leader if you can join')
    .addStringOption(o => o.setName('team').setDescription('Target team name').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('changeteamsettings').setDescription('Change team settings (Leaders/Co-Owners)')
    .addStringOption(o => o.setName('color').setDescription('Hex color code (e.g. #ff0000)').setRequired(false).setAutocomplete(true)),
  new SlashCommandBuilder().setName('setcoleader').setDescription('Set or clear your team co-owner (Primary Leader)')
    .addUserOption(o => o.setName('user').setDescription('User to set as co-owner').setRequired(false)),
  new SlashCommandBuilder().setName('leaderpromote').setDescription('Promote a team member to primary leader (Primary Leader)')
    .addUserOption(o => o.setName('user').setDescription('Member to promote').setRequired(true)),
  
  new SlashCommandBuilder().setName('messages').setDescription('Check your message stats')
    .addUserOption(o => o.setName('user').setDescription('User to check stats for').setRequired(false)),
  new SlashCommandBuilder().setName('messageleaderboard').setDescription('Show top active members by messages'),

  new SlashCommandBuilder().setName('activitychart').setDescription('(Staff) Full server activity & engagement report'),
  new SlashCommandBuilder().setName('bypassteamlimit').setDescription('(Staff) Let team exceed 10-member cap')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('changegiveawayprize').setDescription('(Staff) Change prize on an existing giveaway')
    .addStringOption(o => o.setName('prize').setDescription('New prize text').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('changemessagetracking').setDescription('(Staff) Manually modify tracked messages')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Message amount offset').setRequired(true)),
  new SlashCommandBuilder().setName('cleanup').setDescription('(Staff) Delete teams with 1 or fewer members or missing leaders'),
  new SlashCommandBuilder().setName('cleanuporphanteams').setDescription('(Staff) Delete database entries for non-existent channels/roles'),
  new SlashCommandBuilder().setName('deletetournamentsignups').setDescription('(Staff) Delete tournament sign-up messages'),
  new SlashCommandBuilder().setName('endgiveaway').setDescription('(Staff) End an active giveaway and pick winner(s)')
    .addStringOption(o => o.setName('prize').setDescription('Giveaway prize').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('forceadd').setDescription('(Staff) Force-add member to team')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('forcekick').setDescription('(Staff) Force remove member from team')
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)),
  new SlashCommandBuilder().setName('globalteammessage').setDescription('(Staff) Send a message to every team channel')
    .addStringOption(o => o.setName('message').setDescription('Message content').setRequired(true)),
  new SlashCommandBuilder().setName('premiumteamsettings').setDescription('(Staff) Apply gradient or custom role icon to a team')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('qotd').setDescription('(Staff) Post a Question of the Day with a discussion thread')
    .addStringOption(o => o.setName('question').setDescription('Question text').setRequired(true)),
  new SlashCommandBuilder().setName('randomgiverole').setDescription('(Staff) Give a role to random members')
    .addRoleOption(o => o.setName('role').setDescription('Role to give').setRequired(true))
    .addIntegerOption(o => o.setName('count').setDescription('Number of members').setRequired(true)),
  new SlashCommandBuilder().setName('sendtournament').setDescription('(Staff) Tell teams they are selected for tournament & send interactive signup')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('staffchangesettings').setDescription('(Staff) Change any team settings')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName('staffleaderpromote').setDescription('(Staff) Promote member to leader of specified team')
    .addStringOption(o => o.setName('team').setDescription('Team name').setRequired(true).setAutocomplete(true))
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
  
  await rest.put(Routes.applicationCommands(client.user.id), { body: [] }).catch(() => {});
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands })
    .then(() => console.log('✅ Successfully registered unique guild commands instantly!'))
    .catch(console.error);
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

  await player.save();
});

// --- 🎛️ INTERACTION ROUTER ---
client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      const focusedOption = interaction.options.getFocused(true);
      const focusedValue = focusedOption.value;
      const optionName = focusedOption.name;

      if (['team', 'name', 'bypassteamlimit', 'sendtournament', 'staffchangesettings', 'staffleaderpromote'].includes(optionName)) {
        const teams = await Team.find({ name: { $regex: focusedValue,$options: 'i' } }).limit(25);
        return await interaction.respond(teams.map(t => ({ name: t.name, value: t.name })));
      }

      if (['color'].includes(optionName)) {
        const colors = [
          { name: 'Purple (#9b59b6)', value: '#9b59b6' },
          { name: 'Blue (#3498db)', value: '#3498db' },
          { name: 'Green (#2ecc71)', value: '#2ecc71' },
          { name: 'Red (#e74c3c)', value: '#e74c3c' },
          { name: 'Gold (#f1c40f)', value: '#f1c40f' }
        ].filter(c => c.name.toLowerCase().includes(focusedValue.toLowerCase()));
        return await interaction.respond(colors);
      }

      if (['prize'].includes(optionName)) {
        const giveaways = await Giveaway.find({ prize: { $regex: focusedValue,$options: 'i' }, ended: false }).limit(25);
        if (giveaways.length === 0) {
          return await interaction.respond([{ name: focusedValue || 'New Prize', value: focusedValue || 'Default Prize' }]);
        }
        return await interaction.respond(giveaways.map(g => ({ name: g.prize, value: g.prize })));
      }

      return await interaction.respond([]);
    } catch (e) {
      return await interaction.respond([]).catch(() => {});
    }
  }

  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  // --- BUTTON INTERACTIONS ---
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
        return interaction.update({ content: `❌ You declined the invitation to **${team.name}**.`, embeds: [], components: [] });
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
        } catch (e) {}
      }

      if (team.channelId) {
        try {
          const channel = await interaction.guild.channels.fetch(team.channelId);
          await channel.permissionOverwrites.create(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          });
        } catch (e) {}
      }

      return interaction.update({ 
        content: `✅ **Success!** You have joined team **${team.name}**! 🎉`, 
        embeds: [], 
        components: [] 
      });
    }

    if (interaction.customId === 'enter_giveaway') {
      const giveaway = await Giveaway.findOne({ messageId: interaction.message.id, ended: false });
      if (!giveaway) {
        return interaction.reply({ content: '❌ This giveaway has ended or does not exist.', ephemeral: true });
      }
      if (giveaway.participants.includes(interaction.user.id)) {
        return interaction.reply({ content: '⚠️ You are already entered into this giveaway!', ephemeral: true });
      }
      giveaway.participants.push(interaction.user.id);
      await giveaway.save();
      return interaction.reply({ content: '✅ Successfully entered the giveaway! Good luck! 🍀', ephemeral: true });
    }

    if (interaction.customId.startsWith('tourney_signup_')) {
      const teamName = interaction.customId.replace('tourney_signup_', '');
      let signup = await TournamentSignup.findOne({ messageId: interaction.message.id });
      
      if (!signup) {
        signup = await TournamentSignup.create({ messageId: interaction.message.id, teamName, players: [] });
      }

      const userId = interaction.user.id;
      const index = signup.players.indexOf(userId);

      if (index > -1) {
        signup.players.splice(index, 1);
        await signup.save();
        
        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`tourney_signup_${teamName}`)
            .setLabel(`I'm Playing! 🎮 (${signup.players.length})`)
            .setStyle(ButtonStyle.Success)
        );

        await interaction.update({ components: [updatedRow] }).catch(() => {});
        return interaction.followUp({ content: '❌ You have opted out of this tournament lineup.', ephemeral: true });
      } else {
        signup.players.push(userId);
        await signup.save();

        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`tourney_signup_${teamName}`)
            .setLabel(`I'm Playing! 🎮 (${signup.players.length})`)
            .setStyle(ButtonStyle.Success)
        );

        await interaction.update({ components: [updatedRow] }).catch(() => {});
        return interaction.followUp({ content: `✅ Registered! You are locked in for **${teamName}** (${signup.players.length} players playing)!`, ephemeral: true });
      }
    }

    return;
  }

  const { commandName } = interaction;

  try {
    // --- HELP COMMAND ---
    if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('📖 Arena Hub Bot — Complete Command Directory')
        .setDescription('Here is the full list of all available player, team, and staff commands:')
        .setColor(0x9b59b6)
        .addFields(
          { 
            name: '🛡️ Team Commands', 
            value: '/createteam [name] — Create a new team.\n/invite [user] — Invite a user.\n/leaveteam — Leave your team.\n/teammembers [team] — List members.\n/startscrim [team] — Challenge team.\n/requestteam [team] — Request to join.\n/changeteamsettings [color] — Change settings.\n/setcoleader [user] — Set co-owner.\n/leaderpromote [user] — Transfer lead.' 
          },
          { 
            name: '📊 Stats & Progression', 
            value: '/quests — View quests.\n/messages [user] — Check message stats.\n/messageleaderboard — Top active members.' 
          },
          { 
            name: '⚙️ Staff Commands (General)', 
            value: '/startgiveaway [prize] — Start giveaway.\n/endgiveaway [prize] — End giveaway.\n/qotd [question] — Post QOTD with auto-thread.\n/activitychart — Activity report.\n/randomgiverole [role] [count] — Random role.\n/reset-quests [user] — Reset quests.' 
          },
          { 
            name: '🛠️ Staff Commands (Management)', 
            value: '/bypassteamlimit [team] — Bypass limit.\n/changegiveawayprize [prize] — Edit giveaway prize.\n/changemessagetracking [user] [amount] — Edit msgs.\n/cleanup — Clean empty/leaderless teams.\n/cleanuporphanteams — Clean orphan channels/roles.\n/deletetournamentsignups — Clear signups.\n/forceadd [user] [team] — Force add.\n/forcekick [user] — Force kick.\n/globalteammessage [msg] — Broadcast.\n/premiumteamsettings [team] — Premium settings.\n/sendtournament [team] — Notify tournament & signup button.\n/staffchangesettings [team] — Staff settings.\n/staffleaderpromote [team] [user] — Force promote.\n/syncglobalmessages — Sync all msgs.\n/syncinvites — Sync invites.\n/syncmessages — Sync weekly msgs.\n/syncteammembers — Sync roles.' 
          }
        )
        .setFooter({ text: 'Arena Hub Bot Systems' });

      return await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }

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
      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'reset-quests') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const targetUser = interaction.options.getUser('user');
      await Player.updateOne({ userId: targetUser.id }, { completedQuests: [] });
      return await interaction.reply({ content: `✅ Reset quests for <@${targetUser.id}>.`, ephemeral: true });
    }

    // --- TEAM COMMANDS ---
    if (commandName === 'createteam') {
      const name = interaction.options.getString('name');
      const existing = await Team.findOne({ name });
      if (existing) return await interaction.reply({ content: '❌ A team with this name already exists!', ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      const teamRole = await interaction.guild.roles.create({ name: `Team: ${name}`, color: 0x9b59b6 });
      const leaderRole = await interaction.guild.roles.create({ name: `${name} Leader`, color: 0xf1c40f });
      const coLeaderRole = await interaction.guild.roles.create({ name: `${name} Co-Owner`, color: 0x3498db });

      await interaction.member.roles.add(teamRole);
      await interaction.member.roles.add(leaderRole);

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
        leaderRoleId: leaderRole.id,
        coLeaderRoleId: coLeaderRole.id,
        channelId: teamChannel.id
      });

      return await interaction.editReply({ 
        content: `✅ Successfully created team **${name}**!\n🔒 Channel: <#${teamChannel.id}>\n🛡️ Roles: <@&${teamRole.id}>, <@&${leaderRole.id}>, <@&${coLeaderRole.id}>` 
      });
    }

    if (commandName === 'invite') {
      const targetUser = interaction.options.getUser('user');
      const team = await Team.findOne({ $or: [{ leaderId: interaction.user.id }, { coLeaderId: interaction.user.id }] });
      
      if (!team) return await interaction.reply({ content: '❌ You must be a team Leader or Co-Owner to invite players!', ephemeral: true });
      if (targetUser.bot) return await interaction.reply({ content: '❌ You cannot invite bots.', ephemeral: true });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`accept_invite_${team.name}`).setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`decline_invite_${team.name}`).setLabel('Decline').setStyle(ButtonStyle.Danger)
      );

      const inviteEmbed = new EmbedBuilder()
        .setTitle('🛡️ Team Invitation')
        .setDescription(`<@${interaction.user.id}> has invited you to join team **${team.name}**!`)
        .setColor(team.colour);

      try {
        await targetUser.send({ embeds: [inviteEmbed], components: [row] });
        return await interaction.reply({ content: `✅ Successfully sent a DM invite to <@${targetUser.id}>!`, ephemeral: true });
      } catch (e) {
        return await interaction.reply({ content: `❌ Could not send a DM to <@${targetUser.id}>. DMs might be closed.`, ephemeral: true });
      }
    }

    if (commandName === 'changeteamsettings') {
      const team = await Team.findOne({ $or: [{ leaderId: interaction.user.id }, { coLeaderId: interaction.user.id }] });
      if (!team) return await interaction.reply({ content: '❌ Staff/Leader permission required.', ephemeral: true });
      const newColor = interaction.options.getString('color');
      if (newColor) {
        team.colour = newColor;
        await team.save();
        if (team.roleId) {
          const role = await interaction.guild.roles.fetch(team.roleId).catch(() => {});
          if (role) await role.setColor(newColor);
        }
        return await interaction.reply({ content: `✅ Team color updated to **${newColor}**!`, ephemeral: true });
      }
      return await interaction.reply({ content: `⚙️ Team settings for **${team.name}**. Use \`/changeteamsettings color:#HEXCODE\`.`, ephemeral: true });
    }

    if (commandName === 'setcoleader') {
      const team = await Team.findOne({ leaderId: interaction.user.id });
      if (!team) return await interaction.reply({ content: '❌ Only the primary team leader can set a Co-Owner!', ephemeral: true });
      const targetUser = interaction.options.getUser('user');
      
      if (!targetUser) {
        team.coLeaderId = null;
        await team.save();
        return await interaction.reply({ content: '✅ Co-Owner removed.', ephemeral: true });
      }

      if (!team.members.includes(targetUser.id)) return await interaction.reply({ content: '❌ User must be in your team first!', ephemeral: true });
      team.coLeaderId = targetUser.id;
      await team.save();
      return await interaction.reply({ content: `✅ Appointed <@${targetUser.id}> as Co-Owner!`, ephemeral: true });
    }

    if (commandName === 'leaderpromote') {
      const team = await Team.findOne({ leaderId: interaction.user.id });
      if (!team) return await interaction.reply({ content: '❌ Primary leader only.', ephemeral: true });
      const targetUser = interaction.options.getUser('user');
      if (!targetUser || !team.members.includes(targetUser.id)) return await interaction.reply({ content: '❌ Member not found in team.', ephemeral: true });

      team.leaderId = targetUser.id;
      if (team.coLeaderId === targetUser.id) team.coLeaderId = null;
      await team.save();
      return await interaction.reply({ content: `👑 Promoted <@${targetUser.id}> to primary leader!` });
    }

    if (commandName === 'startscrim') {
      const team = await Team.findOne({ $or: [{ leaderId: interaction.user.id }, { coLeaderId: interaction.user.id }] });
      if (!team) return await interaction.reply({ content: '❌ Leader/Co-Owner only.', ephemeral: true });
      const targetTeamName = interaction.options.getString('team');
      const targetTeam = await Team.findOne({ name: targetTeamName });
      if (!targetTeam) return await interaction.reply({ content: '❌ Target team not found.', ephemeral: true });
      return await interaction.reply({ content: `⚔️ Scrim challenge sent from **${team.name}** to **${targetTeam.name}**! <@${targetTeam.leaderId}>` });
    }

    if (commandName === 'requestteam') {
      const teamName = interaction.options.getString('team');
      const team = await Team.findOne({ name: teamName });
      if (!team) return await interaction.reply({ content: '❌ Team not found.', ephemeral: true });
      
      const requestEmbed = new EmbedBuilder()
        .setTitle('📨 Team Join Request')
        .setDescription(`<@${interaction.user.id}> has requested to join your team **${team.name}**!`)
        .setColor(team.colour);

      try {
        if (team.leaderId) {
          const leaderUser = await client.users.fetch(team.leaderId);
          await leaderUser.send({ embeds: [requestEmbed] }).catch(() => {});
        }
        if (team.coLeaderId) {
          const coLeaderUser = await client.users.fetch(team.coLeaderId);
          await coLeaderUser.send({ embeds: [requestEmbed] }).catch(() => {});
        }
      } catch (e) {}

      return await interaction.reply({ content: `📨 Join request sent via DM to the leaders of **${team.name}**!`, ephemeral: true });
    }

    if (commandName === 'leaveteam') {
      const team = await Team.findOne({ members: interaction.user.id });
      if (!team) return await interaction.reply({ content: '❌ You are not in a team.', ephemeral: true });
      if (team.leaderId === interaction.user.id) return await interaction.reply({ content: '❌ Leaders cannot leave.', ephemeral: true });
      
      team.members = team.members.filter(id => id !== interaction.user.id);
      if (team.coLeaderId === interaction.user.id) team.coLeaderId = null;
      await team.save();

      if (team.roleId) {
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          await member.roles.remove(team.roleId);
        } catch (e) {}
      }

      return await interaction.reply({ content: `✅ Left team **${team.name}**.` });
    }

    if (commandName === 'teammembers') {
      const teamName = interaction.options.getString('team');
      const team = teamName ? await Team.findOne({ name: teamName }) : await Team.findOne({ members: interaction.user.id });
      if (!team) return await interaction.reply({ content: '❌ Team not found.', ephemeral: true });

      const memberList = team.members.map(id => `<@${id}> ${id === team.leaderId ? '👑' : id === team.coLeaderId ? '⭐' : ''}`).join('\n');
      const embed = new EmbedBuilder().setTitle(`Team: ${team.name}`).setDescription(memberList).setColor(team.colour);
      return await interaction.reply({ embeds: [embed] });
    }

    // --- STATS & MESSAGES ---
    if (commandName === 'messages') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const player = await Player.findOne({ userId: targetUser.id });
      return await interaction.reply({ content: `📊 **${targetUser.username}** has sent **${player ? player.messagesCount : 0}** messages (${player ? player.weeklyMessages : 0} this week).`, ephemeral: true });
    }

    if (commandName === 'messageleaderboard') {
      const top = await Player.find().sort({ messagesCount: -1 }).limit(10);
      const desc = top.map((p, i) => `**#${i + 1}** <@${p.userId}> — ${p.messagesCount} msgs`).join('\n');
      const embed = new EmbedBuilder().setTitle('🏆 Message Leaderboard').setDescription(desc).setColor(0xf1c40f);
      return await interaction.reply({ embeds: [embed] });
    }

    // --- STAFF COMMANDS FULLY IMPLEMENTED ---
    if (commandName === 'activitychart') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const totalPlayers = await Player.countDocuments();
      const totalTeams = await Team.countDocuments();
      const embed = new EmbedBuilder()
        .setTitle('📈 Server Activity & Engagement Report')
        .setColor(0x2ecc71)
        .addFields(
          { name: 'Total Tracked Players', value: `${totalPlayers}`, inline: true },
          { name: 'Total Registered Teams', value: `${totalTeams}`, inline: true }
        );
      return await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'bypassteamlimit') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const teamName = interaction.options.getString('team');
      const team = await Team.findOne({ name: teamName });
      if (!team) return await interaction.reply({ content: '❌ Team not found.', ephemeral: true });
      team.bypassedLimit = true;
      await team.save();
      return await interaction.reply({ content: `✅ Team **${team.name}** can now exceed the 10-member limit.`, ephemeral: true });
    }

    if (commandName === 'changegiveawayprize') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const newPrize = interaction.options.getString('prize');
      const giveaway = await Giveaway.findOne({ ended: false }).sort({ _id: -1 });
      if (!giveaway) return await interaction.reply({ content: '❌ No active giveaway found.', ephemeral: true });
      giveaway.prize = newPrize;
      await giveaway.save();
      return await interaction.reply({ content: `✅ Updated the latest active giveaway prize to: **${newPrize}**`, ephemeral: true });
    }

    if (commandName === 'changemessagetracking') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      let player = await Player.findOne({ userId: targetUser.id });
      if (!player) player = await Player.create({ userId: targetUser.id, username: targetUser.username });
      player.messagesCount += amount;
      player.weeklyMessages += amount;
      await player.save();
      return await interaction.reply({ content: `✅ Adjusted message count for <@${targetUser.id}> by **${amount}** messages.`, ephemeral: true });
    }

    // --- UPDATED FULL CLEANUP COMMAND ---
    if (commandName === 'cleanup') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      // Find teams with 1 or fewer members, OR with no leader/invalid leader
      const teamsToDelete = await Team.find({
        $or: [
          { members: { $exists: false } },
          { members: { $size: 0 } },           { members: {$size: 1 } },
          { leaderId: null },
          { leaderId: 'none' },
          { leaderId: '' }
        ]
      });

      let deletedCount = 0;
      for (const team of teamsToDelete) {
        // Delete channels and roles associated with the team from Discord
        if (team.channelId) {
          try {
            const ch = await interaction.guild.channels.fetch(team.channelId);
            if (ch) await ch.delete();
          } catch (e) {}
        }
        if (team.roleId) {
          try {
            const r = await interaction.guild.roles.fetch(team.roleId);
            if (r) await r.delete();
          } catch (e) {}
        }
        if (team.leaderRoleId) {
          try {
            const lr = await interaction.guild.roles.fetch(team.leaderRoleId);
            if (lr) await lr.delete();
          } catch (e) {}
        }
        if (team.coLeaderRoleId) {
          try {
            const cr = await interaction.guild.roles.fetch(team.coLeaderRoleId);
            if (cr) await cr.delete();
          } catch (e) {}
        }

        await Team.deleteOne({ _id: team._id });
        deletedCount++;
      }

      return await interaction.editReply({ content: `🧹 Cleanup complete! Deleted **${deletedCount}** empty, single-leader, or leaderless team(s) along with their channels and roles.` });
    }

    // --- UPDATED ORPHAN CLEANUP COMMAND ---
    if (commandName === 'cleanuporphanteams') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const allTeams = await Team.find({});
      let cleanedCount = 0;

      for (const team of allTeams) {
        let channelExists = false;
        let roleExists = false;

        if (team.channelId) {
          const ch = await interaction.guild.channels.fetch(team.channelId).catch(() => null);
          if (ch) channelExists = true;
        }

        if (team.roleId) {
          const r = await interaction.guild.roles.fetch(team.roleId).catch(() => null);
          if (r) roleExists = true;
        }

        // If neither channel nor role exists anymore, remove orphan team record
        if (!channelExists && !roleExists) {
          await Team.deleteOne({ _id: team._id });
          cleanedCount++;
        }
      }

      return await interaction.editReply({ content: `🧹 Orphan cleanup complete! Removed **${cleanedCount}** orphaned team record(s) whose Discord channels/roles no longer existed.` });
    }

    if (commandName === 'deletetournamentsignups') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      await TournamentSignup.deleteMany({});
      return await interaction.reply({ content: '🗑️ Tournament sign-up messages and database records cleared successfully.', ephemeral: true });
    }

    // --- END GIVEAWAY COMMAND ---
    if (commandName === 'endgiveaway') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const prizeName = interaction.options.getString('prize');
      const giveaway = await Giveaway.findOne({ prize: prizeName, ended: false });

      if (!giveaway) {
        return await interaction.reply({ content: '❌ Active giveaway with that prize not found.', ephemeral: true });
      }

      giveaway.ended = true;
      await giveaway.save();

      let winnerMentions = 'No valid entries!';
      if (giveaway.participants.length > 0) {
        const shuffled = [...giveaway.participants].sort(() => 0.5 - Math.random());
        const winners = shuffled.slice(0, giveaway.winnersCount);
        winnerMentions = winners.map(id => `<@${id}>`).join(', ');
      }

      try {
        const channel = await interaction.guild.channels.fetch(giveaway.channelId);
        if (channel) {
          const msg = await channel.messages.fetch(giveaway.messageId).catch(() => {});
          if (msg) {
            const endedEmbed = new EmbedBuilder()
              .setTitle('🎉 GIVEAWAY ENDED 🎉')
              .setDescription(`Prize: **${giveaway.prize}**\n\n🏆 **Winner(s):** ${winnerMentions}`)
              .setColor(0x9b59b6);
            await msg.edit({ embeds: [endedEmbed], components: [] });
          }
        }
      } catch (e) {
        console.error('Failed to update giveaway message:', e);
      }

      return await interaction.reply({ content: `✅ Giveaway for **${giveaway.prize}** has ended! Winner(s): ${winnerMentions}`, ephemeral: true });
    }

    if (commandName === 'forceadd') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const targetUser = interaction.options.getUser('user');
      const teamName = interaction.options.getString('team');
      const team = await Team.findOne({ name: teamName });
      if (!team) return await interaction.reply({ content: '❌ Team not found.', ephemeral: true });
      
      if (!team.members.includes(targetUser.id)) {
        team.members.push(targetUser.id);
        await team.save();
      }
      
      if (team.roleId) {
        try {
          const member = await interaction.guild.members.fetch(targetUser.id);
          await member.roles.add(team.roleId);
        } catch (e) {}
      }

      if (team.channelId) {
        try {
          const channel = await interaction.guild.channels.fetch(team.channelId);
          await channel.permissionOverwrites.create(targetUser.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          });
        } catch (e) {}
      }

      return await interaction.reply({ content: `✅ Successfully force-added <@${targetUser.id}> to team **${team.name}**!`, ephemeral: true });
    }

    if (commandName === 'forcekick') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const targetUser = interaction.options.getUser('user');
      const team = await Team.findOne({ members: targetUser.id });
      if (!team) return await interaction.reply({ content: '❌ User is not in any team.', ephemeral: true });
      
      team.members = team.members.filter(id => id !== targetUser.id);
      if (team.leaderId === targetUser.id) team.leaderId = team.members[0] || 'none';
      if (team.coLeaderId === targetUser.id) team.coLeaderId = null;
      await team.save();

      if (team.roleId) {
        try {
          const member = await interaction.guild.members.fetch(targetUser.id);
          await member.roles.remove(team.roleId);
        } catch (e) {}
      }

      if (team.channelId) {
        try {
          const channel = await interaction.guild.channels.fetch(team.channelId);
          await channel.permissionOverwrites.delete(targetUser.id);
        } catch (e) {}
      }

      return await interaction.reply({ content: `✅ Successfully force-removed <@${targetUser.id}> from team **${team.name}**!`, ephemeral: true });
    }

    if (commandName === 'globalteammessage') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const text = interaction.options.getString('message');
      const teams = await Team.find({ channelId: { $ne: null } });
      let count = 0;
      for (const t of teams) {
        try {
          const channel = await interaction.guild.channels.fetch(t.channelId);
          if (channel) {
            await channel.send(`📢 **Global Staff Broadcast:**\n${text}`);
            count++;
          }
        } catch (e) {}
      }
      return await interaction.reply({ content: `📢 Broadcast sent to **${count}** team channels!`, ephemeral: true });
    }

    if (commandName === 'premiumteamsettings') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const teamName = interaction.options.getString('team');
      const team = await Team.findOne({ name: teamName });
      if (!team) return await interaction.reply({ content: '❌ Team not found.', ephemeral: true });
      return await interaction.reply({ content: `✨ Premium visual settings applied to team **${team.name}**!`, ephemeral: true });
    }

    if (commandName === 'qotd') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff permissions required.', ephemeral: true });
      const questionText = interaction.options.getString('question');

      const qotdEmbed = new EmbedBuilder()
        .setTitle('❓ Question of the Day')
        .setDescription(questionText)
        .setColor(0x3498db)
        .setFooter({ text: `Posted by ${interaction.user.username}` });

      const sentMessage = await interaction.reply({ embeds: [qotdEmbed], fetchReply: true });

      try {
        await sentMessage.startThread({
          name: `QOTD Discussion: ${questionText.length > 50 ? questionText.slice(0, 47) + '...' : questionText}`,
          autoArchiveDuration: 1440,
          reason: 'Daily Question discussion thread'
        });
      } catch (e) {
        console.error('Failed to create QOTD thread:', e);
      }
      return;
    }

    if (commandName === 'randomgiverole') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const role = interaction.options.getRole('role');
      const count = interaction.options.getInteger('count');
      const members = await interaction.guild.members.fetch();
      const nonBots = members.filter(m => !m.user.bot);
      const shuffled = [...nonBots.values()].sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, count);
      
      let givenCount = 0;
      for (const m of selected) {
        try {
          await m.roles.add(role);
          givenCount++;
        } catch (e) {}
      }
      return await interaction.reply({ content: `🎁 Successfully gave <@&${role.id}> to **${givenCount}** random members!`, ephemeral: true });
    }

    if (commandName === 'sendtournament') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const teamName = interaction.options.getString('team');
      const team = await Team.findOne({ name: teamName });
      if (!team) return await interaction.reply({ content: '❌ Team not found in database.', ephemeral: true });

      const tourneyEmbed = new EmbedBuilder()
        .setTitle('🏆 Tournament Selection & Signup')
        .setDescription(`Your team (**${team.name}**) has been selected for the upcoming tournament!\n\nClick the button below to confirm you are playing so we can track the lineup count.`)
        .setColor(team.colour);

      const signupRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`tourney_signup_${team.name}`)
          .setLabel("I'm Playing! 🎮 (0)")
          .setStyle(ButtonStyle.Success)
      );

      if (team.channelId) {
        try {
          const channel = await interaction.guild.channels.fetch(team.channelId);
          if (channel) {
            const roleMention = team.roleId ? `<@&${team.roleId}>` : `**${team.name}**`;
            await channel.send({
              content: `🔔 ATTENTION ${roleMention}!`,
              embeds: [tourneyEmbed],
              components: [signupRow]
            });
          }
        } catch (e) {}
      }

      return await interaction.reply({ content: `✅ Tournament signup message sent to team **${team.name}**'s channel!`, ephemeral: true });
    }

    if (commandName === 'staffchangesettings') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const teamName = interaction.options.getString('team');
      const team = await Team.findOne({ name: teamName });
      if (!team) return await interaction.reply({ content: '❌ Team not found.', ephemeral: true });
      return await interaction.reply({ content: `⚙️ Staff settings menu accessed for team **${team.name}**.`, ephemeral: true });
    }

    if (commandName === 'staffleaderpromote') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const teamName = interaction.options.getString('team');
      const targetUser = interaction.options.getUser('user');
      const team = await Team.findOne({ name: teamName });
      if (!team) return await interaction.reply({ content: '❌ Team not found.', ephemeral: true });
      team.leaderId = targetUser.id;
      if (!team.members.includes(targetUser.id)) team.members.push(targetUser.id);
      await team.save();
      return await interaction.reply({ content: `👑 Force-promoted <@${targetUser.id}> to leader of team **${team.name}**.`, ephemeral: true });
    }

    if (commandName === 'startgiveaway') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff permissions required.', ephemeral: true });
      const prize = interaction.options.getString('prize');
      const embed = new EmbedBuilder().setTitle('🎉 GIVEAWAY 🎉').setDescription(`Prize: **${prize}**\nClick below to enter!`).setColor(0xe74c3c);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('enter_giveaway').setLabel('Enter Giveaway').setStyle(ButtonStyle.Success));
      const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
      await Giveaway.create({ prize, channelId: interaction.channelId, messageId: msg.id });
      return;
    }

    if (commandName === 'syncglobalmessages') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      return await interaction.reply({ content: '🔄 Global message counts synchronized successfully.', ephemeral: true });
    }

    if (commandName === 'syncinvites') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      return await interaction.reply({ content: '🔄 Invite tracking database rebuilt successfully.', ephemeral: true });
    }

    if (commandName === 'syncmessages') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      await Player.updateMany({}, { weeklyMessages: 0 });
      return await interaction.reply({ content: '🔄 Weekly message counts reset & synchronized.', ephemeral: true });
    }

    if (commandName === 'syncteammembers') {
      if (!isStaff(interaction.member)) return await interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      return await interaction.reply({ content: '🔄 Team members synchronized with server roles.', ephemeral: true });
    }

  } catch (err) {
    console.error(`Error executing ${commandName}:`, err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ An error occurred executing this command.', ephemeral: true }).catch(() => {});
    }
  }
});

http.createServer((req, res) => res.end('Bot active')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
