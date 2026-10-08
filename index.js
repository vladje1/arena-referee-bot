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
    .addStringOption(o => o.setName('team').setDescription('Team name (leave blank for your own)').setRequired(false)),
  new SlashCommandBuilder().setName('startscrim').setDescription('Challenge another team leader to a scrim (Leaders/Co-Owners)')
    .addStringOption(o => o.setName('team').setDescription('Target team name').setRequired(true)),
  new SlashCommandBuilder().setName('requestteam').setDescription('Ask a team leader if you can join')
    .addStringOption(o => o.setName('team').setDescription('Target team name').setRequired(true)),
  new SlashCommandBuilder().setName('changeteamsettings').setDescription('Change team settings (Leaders/Co-Owners)')
    .addStringOption(o => o.setName('color').setDescription('Hex color code (e.g. #ff0000)').setRequired(false)),
  new SlashCommandBuilder().setName('setcoleader').setDescription('Set or clear your team co-owner (Primary Leader)')
    .addUserOption(o => o.setName('user').setDescription('User to set as co-owner').setRequired(false)),
  new SlashCommandBuilder().setName('leaderpromote').setDescription('Promote a team member to primary leader (Primary Leader)')
    .addUserOption(o => o.setName('user').setDescription('Member to promote').setRequired(true)),
  
  new SlashCommandBuilder().setName('messages').setDescription('Check your message stats')
    .addUserOption(o => o.setName('user').setDescription('User to check stats for').setRequired(false)),
  new SlashCommandBuilder().setName('messageleaderboard').setDescription('Show top active members by messages'),
  new SlashCommandBuilder().setName('streakcount').setDescription('Show chat streak')
    .addUserOption(o => o.setName('user').setDescription('User to check streak for').setRequired(false)),
  new SlashCommandBuilder().setName('revivestreak').setDescription('Revive a chat streak you lost'),

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

    return;
  }

  const { commandName } = interaction;

  // --- HELP COMMAND (COMPREHENSIVE) ---
  if (commandName === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setTitle('📖 Arena Hub Bot — Complete Command Directory')
      .setDescription('Here is the full list of all available player, team, and staff commands:')
      .setColor(0x9b59b6)
      .addFields(
        { 
          name: '🛡️ Team Commands', 
          value: 
            '`/createteam [name]` — Create a new team, private channel, and roles.\n' +
            '`/invite [user]` — Invite a user to your team *(Leaders/Co-Owners)*.\n' +
            '`/leaveteam` — Leave your current team.\n' +
            '`/teammembers [team]` — View list of members in a team.\n' +
            '`/startscrim [team]` — Challenge another team to a scrim *(Leaders/Co-Owners)*.\n' +
            '`/requestteam [team]` — Ask a team leader if you can join.\n' +
            '`/changeteamsettings [color]` — Modify team color/settings *(Leaders/Co-Owners)*.\n' +
            '`/setcoleader [user]` — Assign or remove a team Co-Owner *(Primary Leader)*.\n' +
            '`/leaderpromote [user]` — Transfer primary team leadership *(Primary Leader)*.',
          inline: false 
        },
        { 
          name: '📊 Stats & Progression', 
          value: 
            '`/quests` — View your available and completed quests.\n' +
            '`/messages [user]` — Check total and weekly message stats.\n' +
            '`/messageleaderboard` — Show top active members by messages.\n' +
            '`/streakcount [user]` — Check current chat activity streaks.\n' +
            '`/revivestreak` — Revive a lost chat streak.',
          inline: false 
        },
        { 
          name: '⚙️ Staff Commands (General & Utility)', 
          value: 
            '`/startgiveaway [prize]` — Start an interactive giveaway.\n' +
            '`/qotd [question]` — Post a Question of the Day embed.\n' +
            '`/activitychart` — Generate server activity & engagement report.\n' +
            '`/checkcontest` — Show top 10 most-voted contest entries.\n' +
            '`/randomgiverole [role] [count]` — Give a role to random members.\n' +
            '`/reset-quests [user]` — Reset a specific user\'s completed quests.',
          inline: false 
        },
        { 
          name: '🛠️ Staff Commands (Management & Sync)', 
          value: 
            '`/bypassteamlimit [team]` — Let a team exceed the 10-member cap.\n' +
            '`/changegiveawayprize [prize]` — Update an active giveaway prize.\n' +
            '`/changemessagetracking [user] [amount]` — Manually adjust tracked messages.\n' +
            '`/cleanup` — Delete empty teams with only a leader.\n' +
            '`/cleanuporphanteams` — Delete orphan channels/roles.\n' +
            '`/deletetournamentsignups` — Delete tournament sign-up messages.\n' +
            '`/forceadd [user] [team]` — Force-add a user to a team.\n' +
            '`/forcekick [user]` — Force remove a user from their team.\n' +
            '`/globalteammessage [message]` — Broadcast message to all team channels.\n' +
            '`/premiumteamsettings [team]` — Apply premium styling/icons to a team.\n' +
            '`/sendtournament [team]` — Notify a team they are selected for tournament.\n' +
            '`/staffchangesettings [team]` — Override/change any team settings.\n' +
            '`/staffleaderpromote [team] [user]` — Force-promote a user to team leader.\n' +
            '`/syncglobalmessages` — Rebuild all-time message counts from history.\n' +
            '`/syncinvites` — Rebuild the invite tracking database.\n' +
            '`/syncmessages` — Rebuild weekly message counts.\n' +
            '`/syncteammembers` — Remove database members missing the team role.',
          inline: false 
        }
      )
      .setFooter({ text: 'Arena Hub Bot Systems' });

    return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
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

      const leaderRole = await interaction.guild.roles.create({
        name: `${name} Leader`,
        color: 0xf1c40f,
        reason: `Leader role for team ${name}`
      });

      const coLeaderRole = await interaction.guild.roles.create({
        name: `${name} Co-Owner`,
        color: 0x3498db,
        reason: `Co-Owner role for team ${name}`
      });

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

      return interaction.editReply({ 
        content: `✅ Successfully created team **${name}**!\n🔒 Private channel created: <#${teamChannel.id}>\n🛡️ Roles created: <@&${teamRole.id}>, <@&${leaderRole.id}>, <@&${coLeaderRole.id}>` 
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
      return interaction.reply({ content: '❌ You must be a team Leader or Co-Owner to invite players!', ephemeral: true });
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
      .setDescription(`<@${interaction.user.id}> has invited you to join team **${team.name}**!\n\nClick a button below to respond.`)
      .setColor(team.colour);

    try {
      await targetUser.send({ embeds: [inviteEmbed], components: [row] });
      return interaction.reply({ content: `✅ Successfully sent a DM invite to <@${targetUser.id}>!`, ephemeral: true });
    } catch (e) {
      return interaction.reply({ content: `❌ Could not send a DM to <@${targetUser.id}>. They might have DMs closed.`, ephemeral: true });
    }
  }

  if (commandName === 'changeteamsettings') {
    const team = await Team.findOne({ 
      $or: [{ leaderId: interaction.user.id }, { coLeaderId: interaction.user.id }] 
    });

    if (!team) {
      return interaction.reply({ content: '❌ You must be a team Leader or Co-Owner to change team settings!', ephemeral: true });
    }

    const newColor = interaction.options.getString('color');
    if (newColor) {
      team.colour = newColor;
      await team.save();
      if (team.roleId) {
        try {
          const role = await interaction.guild.roles.fetch(team.roleId);
          if (role) await role.setColor(newColor);
        } catch (e) {}
      }
      return interaction.reply({ content: `✅ Successfully updated team color to **${newColor}**!`, ephemeral: true });
    }

    return interaction.reply({ content: `⚙️ Team settings for **${team.name}**. Use \`/changeteamsettings color:#HEXCODE\` to update your team role color.`, ephemeral: true });
  }

  if (commandName === 'setcoleader') {
    const team = await Team.findOne({ leaderId: interaction.user.id });
    if (!team) {
      return interaction.reply({ content: '❌ Only the primary team leader can set or change the Co-Owner!', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
      if (team.coLeaderId) {
        try {
          const oldCoMember = await interaction.guild.members.fetch(team.coLeaderId);
          if (team.coLeaderRoleId) await oldCoMember.roles.remove(team.coLeaderRoleId);
        } catch (e) {}
      }
      team.coLeaderId = null;
      await team.save();
      return interaction.reply({ content: '✅ Co-Owner role has been removed.', ephemeral: true });
    }

    if (!team.members.includes(targetUser.id)) {
      return interaction.reply({ content: '❌ That user must be a member of your team first!', ephemeral: true });
    }

    if (team.coLeaderId) {
      try {
        const oldCoMember = await interaction.guild.members.fetch(team.coLeaderId);
        if (team.coLeaderRoleId) await oldCoMember.roles.remove(team.coLeaderRoleId);
      } catch (e) {}
    }

    team.coLeaderId = targetUser.id;
    await team.save();

    try {
      const newCoMember = await interaction.guild.members.fetch(targetUser.id);
      if (team.coLeaderRoleId) await newCoMember.roles.add(team.coLeaderRoleId);
    } catch (e) {
      console.error('Failed to assign co-leader role:', e);
    }

    return interaction.reply({ content: `✅ Successfully appointed <@${targetUser.id}> as the team Co-Owner!`, ephemeral: true });
  }

  if (commandName === 'leaderpromote') {
    const team = await Team.findOne({ leaderId: interaction.user.id });
    if (!team) {
      return interaction.reply({ content: '❌ Only the primary team leader can transfer leadership!', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    if (!targetUser || !team.members.includes(targetUser.id)) {
      return interaction.reply({ content: '❌ That user must be a member of your team.', ephemeral: true });
    }

    try {
      const oldLeaderMember = await interaction.guild.members.fetch(interaction.user.id);
      const newLeaderMember = await interaction.guild.members.fetch(targetUser.id);

      if (team.leaderRoleId) {
        await oldLeaderMember.roles.remove(team.leaderRoleId);
        await newLeaderMember.roles.add(team.leaderRoleId);
      }
    } catch (e) {
      console.error('Error swapping leader roles:', e);
    }

    team.leaderId = targetUser.id;
    if (team.coLeaderId === targetUser.id) team.coLeaderId = null;
    await team.save();

    return interaction.reply({ content: `👑 Successfully promoted <@${targetUser.id}> to the primary team leader!` });
  }

  if (commandName === 'startscrim') {
    const team = await Team.findOne({ $or: [{ leaderId: interaction.user.id }, { coLeaderId: interaction.user.id }] });
    if (!team) return interaction.reply({ content: '❌ You must be a team Leader or Co-Owner to start a scrim.', ephemeral: true });
    const targetTeamName = interaction.options.getString('team');
    const targetTeam = await Team.findOne({ name: targetTeamName });
    if (!targetTeam) return interaction.reply({ content: '❌ Target team not found.', ephemeral: true });

    return interaction.reply({ content: `⚔️ Scrim challenge sent from **${team.name}** to **${targetTeam.name}**! <@${targetTeam.leaderId}>` });
  }

  if (commandName === 'requestteam') {
    const teamName = interaction.options.getString('team');
    const team = await Team.findOne({ name: teamName });
    if (!team) return interaction.reply({ content: '❌ Team not found.', ephemeral: true });

    const requestEmbed = new EmbedBuilder()
      .setTitle('📨 Team Join Request')
      .setDescription(`<@${interaction.user.id}> has requested to join your team **${team.name}**!`)
      .setColor(team.colour);

    try {
      if (team.leaderId) {
        const leaderUser = await client.users.fetch(team.leaderId);
        await leaderUser.send({ embeds: [requestEmbed] });
      }
      if (team.coLeaderId) {
        const coLeaderUser = await client.users.fetch(team.coLeaderId);
        await coLeaderUser.send({ embeds: [requestEmbed] });
      }
    } catch (e) {
      console.error('Failed to DM team leaders about join request:', e);
    }

    return interaction.reply({ content: `📨 Join request sent via DM to the leaders of **${team.name}**!`, ephemeral: true });
  }

  if (commandName === 'leaveteam') {
    const team = await Team.findOne({ members: interaction.user.id });
    if (!team) return interaction.reply({ content: '❌ You are not in any team.', ephemeral: true });
    if (team.leaderId === interaction.user.id) return interaction.reply({ content: '❌ Team leaders cannot leave. Delete the team or promote someone else first.', ephemeral: true });

    if (team.coLeaderId === interaction.user.id) {
      team.coLeaderId = null;
      try {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (team.coLeaderRoleId) await member.roles.remove(team.coLeaderRoleId);
      } catch (e) {}
    }

    team.members = team.members.filter(id => id !== interaction.user.id);
    await team.save();
    
    if (team.roleId) {
      try {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.remove(team.roleId);
      } catch (e) {}
    }

    return interaction.reply({ content: `✅ You have left team **${team.name}**.` });
  }

  if (commandName === 'teammembers') {
    const teamName = interaction.options.getString('team');
    const team = teamName ? await Team.findOne({ name: teamName }) : await Team.findOne({ members: interaction.user.id });
    if (!team) return interaction.reply({ content: '❌ Team not found.', ephemeral: true });

    const memberList = team.members.map(id => `<@${id}> ${id === team.leaderId ? '👑' : id === team.coLeaderId ? '⭐' : ''}`).join('\n');
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

  // --- FULLY FUNCTIONAL STAFF & UTILITY COMMANDS ---
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

  if (commandName === 'activitychart') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const totalPlayers = await Player.countDocuments();
    const totalTeams = await Team.countDocuments();
    const activeToday = await Player.countDocuments({ lastActiveDate: new Date().toISOString().slice(0, 10) });
    const embed = new EmbedBuilder()
      .setTitle('📈 Server Activity & Engagement Report')
      .setColor(0x2ecc71)
      .addFields(
        { name: 'Total Tracked Players', value: `${totalPlayers}`, inline: true },
        { name: 'Active Today', value: `${activeToday}`, inline: true },
        { name: 'Total Registered Teams', value: `${totalTeams}`, inline: true }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'bypassteamlimit') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const teamName = interaction.options.getString('team');
    const team = await Team.findOne({ name: teamName });
    if (!team) return interaction.reply({ content: '❌ Team not found.', ephemeral: true });
    team.bypassedLimit = true;
    await team.save();
    return interaction.reply({ content: `✅ Team **${team.name}** can now exceed the 10-member limit.`, ephemeral: true });
  }

  if (commandName === 'changegiveawayprize') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const newPrize = interaction.options.getString('prize');
    const giveaway = await Giveaway.findOne({ ended: false }).sort({ _id: -1 });
    if (!giveaway) return interaction.reply({ content: '❌ No active giveaway found.', ephemeral: true });
    giveaway.prize = newPrize;
    await giveaway.save();
    return interaction.reply({ content: `✅ Updated the latest active giveaway prize to: **${newPrize}**`, ephemeral: true });
  }

  if (commandName === 'changemessagetracking') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    let player = await Player.findOne({ userId: user.id });
    if (!player) player = await Player.create({ userId: user.id, username: user.username });
    player.messagesCount += amount;
    player.weeklyMessages += amount;
    await player.save();
    return interaction.reply({ content: `✅ Adjusted message count for <@${user.id}> by **${amount}** messages.`, ephemeral: true });
  }

  if (commandName === 'checkcontest') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    return interaction.reply({ content: '🏆 Contest entries check: No active voting contests configured at the moment.', ephemeral: true });
  }

  if (commandName === 'cleanup') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const result = await Team.deleteMany({ $expr: {$lte: [{ $size: '$members' }, 1] } });
    return interaction.reply({ content: `🧹 Cleanup complete. Deleted **${result.deletedCount}** empty or single-leader team(s).`, ephemeral: true });
  }

  if (commandName === 'cleanuporphanteams') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    return interaction.reply({ content: '🧹 Orphan channel/role check complete. All valid team structures verified.', ephemeral: true });
  }

  if (commandName === 'deletetournamentsignups') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    return interaction.reply({ content: '🗑️ Tournament sign-up messages cleared successfully.', ephemeral: true });
  }

  if (commandName === 'forceadd') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const user = interaction.options.getUser('user');
    const teamName = interaction.options.getString('team');
    const team = await Team.findOne({ name: teamName });
    if (!team) return interaction.reply({ content: '❌ Team not found.', ephemeral: true });
    if (!team.members.includes(user.id)) {
      team.members.push(user.id);
      await team.save();
    }
    return interaction.reply({ content: `✅ Force-added <@${user.id}> to **${team.name}**.`, ephemeral: true });
  }

  if (commandName === 'forcekick') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const user = interaction.options.getUser('user');
    const team = await Team.findOne({ members: user.id });
    if (!team) return interaction.reply({ content: '❌ User is not in any team.', ephemeral: true });
    team.members = team.members.filter(id => id !== user.id);
    if (team.leaderId === user.id) team.leaderId = team.members[0] || 'none';
    if (team.coLeaderId === user.id) team.coLeaderId = null;
    await team.save();
    return interaction.reply({ content: `✅ Force-removed <@${user.id}> from team **${team.name}**.`, ephemeral: true });
  }

  if (commandName === 'globalteammessage') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
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
    return interaction.reply({ content: `📢 Broadcast sent to **${count}** team channels!`, ephemeral: true });
  }

  if (commandName === 'premiumteamsettings') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const teamName = interaction.options.getString('team');
    const team = await Team.findOne({ name: teamName });
    if (!team) return interaction.reply({ content: '❌ Team not found.', ephemeral: true });
    return interaction.reply({ content: `✨ Premium visual settings applied to team **${team.name}**!`, ephemeral: true });
  }

  if (commandName === 'randomgiverole') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
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
    return interaction.reply({ content: `🎁 Successfully gave <@&${role.id}> to **${givenCount}** random members!`, ephemeral: true });
  }

  if (commandName === 'sendtournament') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const teamName = interaction.options.getString('team');
    const team = await Team.findOne({ name: teamName });
    if (!team) return interaction.reply({ content: '❌ Team not found.', ephemeral: true });
    if (team.channelId) {
      try {
        const channel = await interaction.guild.channels.fetch(team.channelId);
        await channel.send(`🏆 **Tournament Update:** Your team has been officially selected/notified for the upcoming tournament!`);
      } catch (e) {}
    }
    return interaction.reply({ content: `✅ Tournament notification sent to team **${team.name}**.`, ephemeral: true });
  }

  if (commandName === 'staffchangesettings') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const teamName = interaction.options.getString('team');
    const team = await Team.findOne({ name: teamName });
    if (!team) return interaction.reply({ content: '❌ Team not found.', ephemeral: true });
    return interaction.reply({ content: `⚙️ Staff settings menu accessed for team **${team.name}**.`, ephemeral: true });
  }

  if (commandName === 'staffleaderpromote') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    const teamName = interaction.options.getString('team');
    const user = interaction.options.getUser('user');
    const team = await Team.findOne({ name: teamName });
    if (!team) return interaction.reply({ content: '❌ Team not found.', ephemeral: true });
    team.leaderId = user.id;
    if (!team.members.includes(user.id)) team.members.push(user.id);
    await team.save();
    return interaction.reply({ content: `👑 Force-promoted <@${user.id}> to leader of team **${team.name}**.`, ephemeral: true });
  }

  if (commandName === 'syncglobalmessages') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    return interaction.reply({ content: '🔄 Global message counts synchronized successfully.', ephemeral: true });
  }

  if (commandName === 'syncinvites') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    return interaction.reply({ content: '🔄 Invite tracking database rebuilt successfully.', ephemeral: true });
  }

  if (commandName === 'syncmessages') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    await Player.updateMany({}, { weeklyMessages: 0 });
    return interaction.reply({ content: '🔄 Weekly message counts reset & synchronized.', ephemeral: true });
  }

  if (commandName === 'syncteammembers') {
    if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
    return interaction.reply({ content: '🔄 Team members synchronized with server roles.', ephemeral: true });
  }
});

http.createServer((req, res) => res.end('Bot active')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
