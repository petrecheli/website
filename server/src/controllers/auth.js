'use strict';
const auth = require('../models/auth'),
	axios = require('axios'),
	config = require('../../config/config'),
	user = require('../models/user');

module.exports = {

	throughSteam: (req, res, next) => {
		// Redirected to the steam login page
		// Code here won't be executed
	},

	throughSteamReturn: (req, res, next) => {
		auth.genAccessToken(req.user)
		.then((accessToken) => {
			res.cookie('accessToken', accessToken);
			res.redirect('/dashboard');
		}).catch(next);
	},

	verifyUserTicket: (req, res, next) => {
		const userTicket = Buffer.from(req.body, 'utf8').toString('hex');
		const idToVerify = req.get('id');

		if (userTicket && idToVerify) {
			axios.get('https://api.steampowered.com/ISteamUserAuth/AuthenticateUserTicket/v1/', {
				params: {
					key: config.steam.webAPIKey,
					appid: 669270,
					ticket: userTicket
				}
			}).then((sres) => {
				if (sres.data.response.params.result === 'OK') {
					if (idToVerify === sres.data.response.params.steamid) {
						user.findOrCreateFromGame(idToVerify).then((usr) => {
							auth.genAccessToken(usr, true).then(token => {
								res.json({
									token: token,
									length: token.length,
								});
							}).catch(next);
						}).catch(next);
					}
					else
						res.sendStatus(401); // Generate an error here
				}
				else
					res.send(sres.data); // TODO parse the error?
			}).catch(next);
		}
		else
			res.sendStatus(400); // Bad request
	}
};
