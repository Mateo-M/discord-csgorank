const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const GlobalOffensive = require('globaloffensive');
const request = require('request');
const Discord = require('discord.js');

const config = require('./config.json');

const discordClient = new Discord.Client();
const steamClient = new SteamUser();
const csgo = new GlobalOffensive(steamClient);

// Setup the login settings for Steam
var logonSettings = {
	accountName: config.steam.account.username,
	password: config.steam.account.password
};

// Generate a 2FA code if we have a sharedSecret provided
if (config.steam.account.sharedSecret && config.steam.account.sharedSecret.length > 5) {
	logonSettings.twoFactorCode = SteamTotp.getAuthCode(config.steam.account.sharedSecret);
	console.log('Generated steam guard code: ' + logonSettings.twoFactorCode);
} else {
	console.log('No shared secret provided');
}

// Usual logging
discordClient.on('ready', () => {
	console.log('Ready to spy on ' + discordClient.users.size + ' users, in ' + discordClient.channels.size + ' channels of ' + discordClient.guilds.size + ' servers as ' + discordClient.user.tag + '.');
});

// Create a map so we know which user is related to which Steam account
var onGoing = new Map();

// Listen to messages
discordClient.on('message', async (msg) => {
	// Command system
	if (!msg.guild || msg.content.indexOf(config.prefix) !== 0) return;

	const args = msg.content.split(/ +/g);
	const command = args.shift().slice(config.prefix.length).toLowerCase();

	// "rank" command
	if (command === 'rank') {
		// If we are inside the "onGoing" map check if it has been 10 or more minutes since the initial request
		if (onGoing.has(msg.author.id)) {
			var value = onGoing.get(msg.author.id);
			if ((new Date().getTime() - value.date.getTime()) >= (10 * 60 * 1000)) { // 10 minute timeout
				onGoing.delete(msg.author.id);
			} else {
				msg.channel.send('I am currently in the process of verifying you.');
				return;
			}
		}

		// We need an argument (eg: Steam Profile) in order for this to work
		if (!args[0]) {
			msg.channel.send('Please use `' + config.prefix + 'rank <Your Steam Profile Link>` to get yourself a rank');
			return;
		}

		// Parse Steam ID out of given text
		// From my Steam Ban Notifier: https://github.com/BeepFelix/Discord-SteamBan-Notifier/blob/ab148d6c4311cd5d00bec058e783985cc5047d20/modules/functions.js#L32
		return new Promise((resolve, reject) => {
			var text = args[0];
			text = text.replace(/[^A-Za-z0-9_-]+$/g, '');
			text = text.split('/')[text.split('/').length - 1];

			try {
				var sid = new SteamID(text);
			} catch(e) {};

			if (sid && sid.isValid() && sid.type === SteamID.Type.INDIVIDUAL) {
				request('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2?key=' + config.steam.steamWebAPIKey + '&steamids=' + sid.getSteamID64(), (err, res, body) => {
					if (err) {
						reject(err);
						return;
					}

					var json = undefined;
					try {
						json = JSON.parse(body);
					} catch(e) {};

					if (!json || !json.response || !Array.isArray(json.response.players)) {
						console.log(json || body);
						reject('Malformed Steam API Response');
						return;
					}

					if (json.response.players.length < 1) {
						reject('Entered SteamID is not a valid user');
						return;
					}

					resolve(json.response.players[0].steamid);
				});
				return;
			}

			if (sid && sid.isValid() && sid.type !== SteamID.Type.INDIVIDUAL) {
				reject('Entered SteamID is not a valid user');
				return;
			}

			var matches = text.match(/[A-Za-z0-9_-]+($|.$)/);
			if (!matches || matches.length < 1) {
				reject('Entered SteamID is not a valid user');
				return;
			}

			request('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1?key=' + config.steam.steamWebAPIKey + '&vanityurl=' + matches[0] + '&url_type=1', (err, res, body) => {
				if (err) {
					reject(err);
					return;
				}

				var json = undefined;
				try {
					json = JSON.parse(body);
				} catch(e) {};

				if (!json) {
					console.log(body);
					reject('Malformed Steam API Response');
					return;
				}

				if (!json.response) {
					console.log(json);
					reject('Malformed Steam API Response');
					return;
				}

				if (!json.response.steamid) {
					reject('Entered SteamID is not a valid user');
					return;
				}

				resolve(json.response.steamid);
			});
		}).then((steamid) => {
			// We got a steam ID, request the user to add us
			msg.channel.send({ embed: {
				title: 'Please add me on Steam',
				url: 'https://steamcommunity.com/profiles/' + steamClient.steamID.getSteamID64(),
				color: Discord.Util.resolveColor('#ffaa00')
			}}).then((m) => {
				onGoing.set(msg.author.id, { date: new Date(), steamid: steamid, channel: m.channel.id, message: m.id });
			});
		}).catch((err) => {
			// Print error
			if (typeof err === 'string') {
				msg.channel.send({ embed: {
					title: 'Error',
					description: err,
					color: Discord.Util.resolveColor('#ff0000')
				}});
			} else {
				console.error(err);

				msg.channel.send({ embed: {
					title: 'Error',
					description: 'Failed to contact Steam API',
					color: Discord.Util.resolveColor('#ff0000')
				}});
			}
		});
	}
});

discordClient.on('warn', (warn) => console.warn(warn));
discordClient.on('error', (error) => console.error(error));

// Log into Steam first and then log into Discord
steamClient.logOn(logonSettings);

steamClient.on('loggedOn', (details) => {
	console.log('Successfully logged into ' + steamClient.steamID.getSteamID64());

	steamClient.setPersona(SteamUser.Steam.EPersonaState.Online);
	steamClient.gamesPlayed([ 730 ]) // Start CSGO

	// If we cannot log into discord terminate the process
	discordClient.login(config.botToken).catch((e) => {
		console.error(e);
		process.exit(1);
	});
});

// Terminate the process if we have an error during login
discordClient.on('error', (e) => {
	console.error(e);
	process.exit(1);
});

// Check for relationship changes
steamClient.on('friendRelationship', async (sid, relationship) => {
	if (relationship === SteamUser.EFriendRelationship.Friend) { // If the relationship changes to "Friend" it means we are now friends
		// Find the user in our "onGoing" map
		var found = undefined;
		onGoing.forEach((value, key) => {
			if (value.steamid === sid.getSteamID64()) {
				found = {};
				found = { discord: key, steam: sid.getSteamID64(), channel: value.channel, message: value.message };
			}
		});
		if (found === undefined) { // This shouldn't really happen
			steamClient.removeFriend(sid);
			return;
		}

		// Get user and channel
		var user = discordClient.users.get(found.discord);
		var channel = discordClient.channels.get(found.channel);
		if (!channel || !user) return; // No more channel or user

		// Fetch our own message from earlier so we can edit it
		var m = await channel.messages.fetch(found.message).catch(() => {});

		// Get CSGO user profile (Since recent GC changes you can now request the player rank without the user having to have CSGO running)
		csgo.requestPlayersProfile(found.steam, async (profile) => {
			steamClient.removeFriend(sid); // Remove the user from our friend list he is no longer needed

			if (!channel) return; // We couldn't find the channel the message was written in. Something went wrong

			var member = channel.guild.member(user);
			if (!member) { // The user is no longer in the guild
				onGoing.delete(user.id);
				return;
			}

			// Remove user from onGoing requests list
			onGoing.delete(user.id);

			// Remove all rank roles incase the user has any
			await member.roles.remove(config.ranks).catch(() => {});

			// Add the one specific role for the users rank
			member.roles.add(config.ranks[profile.ranking.rankId]).then(() => {
				if (!m || m.deleted) return;

				// Edit the message with success if we were able to fetch it
				m.edit({ embed: {
					title: 'You have been assigned ' + member.guild.roles.get(config.ranks[profile.ranking.rankId]).name,
					color: Discord.Util.resolveColor('#00ff00')
				}});
			}).catch((e) => {
				if (!m || m.deleted) return;

				// Edit the message with the error if we were able to fetch it
				m.edit({ embed: {
					title: 'Failed to assign a role',
					description: e.message || e,
					color: Discord.Util.resolveColor('#ff0000')
				}});
			});
		});
	} else if (relationship === SteamUser.EFriendRelationship.RequestRecipient) { // If the relationship changes to "outstanding" it means we got an incoming friend request
		// Find the user in our "onGoing" map
		var found = false;
		onGoing.forEach((value) => {
			if (value.steamid === sid.getSteamID64()) {
				found = true;
			}
		});

		if (found === false) { // We didn't expect a friend request from this user
			steamClient.removeFriend(sid);
			return;
		}

		// Accept friend request. "friendRelationship" will automatically trigger again
		steamClient.addFriend(sid);
	}
});

process.on('uncaughtException', (e) => console.error(e));
process.on('unhandledRejection', (e) => console.error(e));
