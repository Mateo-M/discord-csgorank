# Based on https://github.com/BeepFelix's work

# Discord CSGO Ranks
Assign users a role based on their CSGO rank

**Requires a Steam Account with CSGO on it**

*(Maybe CSGO free works, probably not I haven't tried it)*

You can leave "sharedSecret" empty if the bot account doesnt have 2FA

The "ranks" array in the config HAS to be setup like in the example. You cannot remove or add an entry to it or it will assign the wrong role. You can have the same ID though.

For example you can put the same ID in "Gold Nova 1", "Gold Nova 2, "Gold Nova 3 and "Gold Nova Master" without any problems but you **cannot** remove the entry "Gold Nova Master".

*According to my quick test it works, although there might be a few issues I haven't though of*
