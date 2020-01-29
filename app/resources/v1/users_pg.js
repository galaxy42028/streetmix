const config = require('config')
const uuidv1 = require('uuid/v1')
const Twitter = require('twitter')
const cloudinary = require('cloudinary')
const { ERRORS, asUserJson } = require('../../../lib/util')
const logger = require('../../../lib/logger.js')()
const { User, Sequelize } = require('../../db/models')

const Op = Sequelize.Op

exports.post = async function (req, res) {
  let loginToken = null
  const hasPriorCall = false

  const handleCreateUser = function (err, user) {
    if (err) {
      logger.error(err)
      res.status(500).json({ status: 500, msg: 'Could not create user.' })
      return
    }
    const userJson = { id: user.id, loginToken: loginToken }
    logger.info({ user: userJson }, 'New user created.')
    res.header('Location', config.restapi.baseuri + '/v1/users/' + user.id)
    if (hasPriorCall) {
      res.send(userJson)
    } else {
      res.status(201).send(userJson)
    }
  } // END function - handleCreateUser

  const handleUpdateUserError = function (err) {
    if (err) {
      logger.error(err)
      res.status(500).json({ status: 500, msg: 'Could not update user.' })
    }
  }

  const handleUpdateUser = function (user) {
    const userJson = { id: user.id, loginToken: loginToken }
    logger.info({ user: userJson }, 'Existing user issued new login token.')

    res.header('Location', config.restapi.baseuri + '/v1/users/' + user.id)
    if (hasPriorCall) {
      res.send(userJson)
    } else {
      res.status(200).send(userJson)
    }
  } // END function - handleUpdateUser

  const handleAuth0TwitterSignIn = async function (credentials) {
    try {
      let user
      if (credentials.auth0_id) {
        user = await User.findOne({ where: { id: credentials.screenName } })
      }
      loginToken = uuidv1()
      if (!user) {
        const newUserData = {
          id: credentials.screenName,
          _id: credentials.auth0_id.split('|')[1],
          auth0_id: credentials.auth0_id,
          login_tokens: [loginToken],
          profile_image_url: credentials.profile_image_url
        }
        User.create(newUserData).then(handleCreateUser)
      } else {
        user.id = credentials.screenName
        user.auth0_id = credentials.auth0_id
        user.profile_image_url = credentials.profile_image_url
        if (user.login_tokens) {
          const newArray = user.login_tokens.concat(loginToken)
          user.login_tokens = newArray
        } else {
          user.login_tokens = [loginToken]
        }

        try {
          // await User.update(user, { where: { id: credentials.screenName } })
          await user.save()
          handleUpdateUser(user)
        } catch (err) {
          handleUpdateUserError(err)
        }
      }
    } catch (err) {
      logger.error(err)
      res.status(500).json({
        status: 500,
        msg: 'Error finding user with Auth Twitter Sign-in.'
      })
    }
  } // END function - handleAuth0TwitterSignIn

  const handleTwitterSignIn = async function (credentials) {
    try {
      let user
      if (credentials.auth0_id) {
        user = await User.findOne({ where: { id: credentials.screenName } })
      }
      loginToken = uuidv1()
      if (!user) {
        const newUserData = {
          id: credentials.screenName,
          _id: credentials.auth0_id.split('|')[1],
          auth0_id: credentials.auth0_id,
          login_tokens: [loginToken],
          profile_image_url: credentials.profile_image_url
        }
        User.create(newUserData).then(handleCreateUser)
      } else {
        user.id = credentials.screenName
        user.auth0_id = credentials.auth0_id
        user.profile_image_url = credentials.profile_image_url
        if (user.login_tokens) {
          user.login_tokens.push(loginToken)
        } else {
          user.login_tokens = [loginToken]
        }
        User.update(user, { where: { id: credentials.screenName } })
          .then(handleUpdateUser)
          .catch(handleUpdateUserError)
      }
    } catch (err) {
      logger.error(err)
      res.status(500).json({
        status: 500,
        msg: 'Error finding user with twitter screenName.'
      })
    }
  } // END function - handleTwitterSignIn

  /**
   * Returns a randomly-generated 4-digit string of a number between 0000 and 9999
   *
   * @returns {string}
   */
  const generateRandomId = () =>
    Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0')

  const generateId = function (nickname) {
    // TODO - Check if the Id generated is not existing
    const id = generateRandomId()
    return nickname + '-' + id
  }

  const handleUserProfileImage = async function (user, credentials) {
    const publicId = `${config.env}/profile_image/${user.id}`
    let profileImageUrl

    // Check if user has profile image already cached in cloudinary
    if (user.profile_image_url && user.profile_image_url.includes(publicId)) {
      profileImageUrl = user.profile_image_url
    } else if (credentials.profile_image_url) {
      // If no profile image cached in cloudinary, cache image provided by credentials and return cloudinary url.
      try {
        const response = await cloudinary.v2.uploader.upload(
          credentials.profile_image_url,
          { upload_preset: 'profile_image', public_id: publicId }
        )
        profileImageUrl = response.secure_url
      } catch (error) {
        logger.error(error)
        // If unable to cache image, return credentials.profile_image_url.
        profileImageUrl = credentials.profile_image_url
      }
    }

    return profileImageUrl
  }

  const handleAuth0SignIn = async function (credentials) {
    try {
      let user
      if (credentials.auth0_id) {
        user = await User.findOne({ where: { auth0_id: credentials.auth0_id } })
      }
      loginToken = uuidv1()
      if (!user) {
        const numOfUser = await User.findOne({
          where: { id: credentials.nickname }
        })
        // Ensure there is no existing user with id same this nickname
        if (!numOfUser) {
          const newUserData = {
            id: credentials.nickname,
            _id: credentials.auth0_id.split('|')[1],
            auth0_id: credentials.auth0_id,
            email: credentials.email,
            login_tokens: [loginToken],
            profile_image_url: credentials.profile_image_url
          }
          User.create(newUserData).then(handleCreateUser)
        } else {
          const id = generateId(credentials.nickname)
          const newUserData = {
            id: id,
            _id: credentials.auth0_id.split('|')[1],
            auth0_id: credentials.auth0_id,
            email: credentials.email,
            login_tokens: [loginToken],
            profile_image_url: credentials.profile_image_url
          }
          User.create(newUserData).then(handleCreateUser)
        }
      } else {
        const profileImageUrl = await handleUserProfileImage(user, credentials)

        user.auth0_id = credentials.auth0_id
        user.profile_image_url = profileImageUrl
        user.email = credentials.email
        if (!user.login_tokens) {
          user.login_tokens = []
        }
        user.login_tokens.push(loginToken)
        User.update(user, { where: { id: credentials.screenName } })
          .then(handleUpdateUser)
          .catch(handleUpdateUserError)
      }
    } catch (err) {
      logger.error(err)
      res
        .status(500)
        .json({ status: 500, msg: 'Error finding user with Auth0 ID.' })
    }
  } // END function - handleAuth0SignIn

  let body
  try {
    body = req.body
  } catch (e) {
    res.status(400).json({ status: 400, msg: 'Could not parse body as JSON.' })
    return
  }

  logger.info(body)
  if (Object.prototype.hasOwnProperty.call(body, 'twitter')) {
    handleTwitterSignIn(body.twitter)
  } else if (Object.prototype.hasOwnProperty.call(body, 'auth0_twitter')) {
    handleAuth0TwitterSignIn(body.auth0_twitter)
  } else if (Object.prototype.hasOwnProperty.call(body, 'auth0')) {
    handleAuth0SignIn(body.auth0)
  } else {
    res.status(400).json({ status: 400, msg: 'Unknown sign-in method used.' })
  }
} // END function - exports.post

exports.get = async function (req, res) {
  // Flag error if user ID is not provided
  if (!req.params.user_id) {
    res.status(400).json({ status: 400, msg: 'Please provide user ID.' })
    return
  }
  const userId = req.params.user_id
  const handleFindUser = function (user) {
    let twitterApiClient
    try {
      twitterApiClient = new Twitter({
        consumer_key: config.twitter.oauth_consumer_key,
        consumer_secret: config.twitter.oauth_consumer_secret,
        access_token_key: user.twitter_credentials.access_token_key,
        access_token_secret: user.twitter_credentials.access_token_secret
      })
    } catch (e) {
      logger.error('Could not initialize Twitter API client. Error:')
      logger.error(e)
    }

    const sendUserJson = function (data) {
      if (data) {
        user.profileImageUrl = data.twitter_profile_image_url
      } else {
        user.profileImageUrl = user.profile_image_url
      }

      res.status(200).send(asUserJson(data || user))
    }

    let responseAlreadySent = false

    const handleFetchUserProfileFromTwitter = function (err, res) {
      if (err) {
        logger.error('Twitter API call users/show returned error.')
        logger.error(err)
      }

      if (responseAlreadySent) {
        logger.debug(
          { profile_image_url: res.profile_image_url },
          'Twitter API users/show call returned but response already sent!'
        )
      } else {
        logger.debug(
          { profile_image_url: res.profile_image_url },
          'Twitter API users/show call returned. Sending response with Twitter data.'
        )
        responseAlreadySent = true

        if (!res) {
          logger.error('Twitter API call users/show did not return any data.')
        }

        sendUserJson({
          twitter_profile_image_url: res.picture
        })
      }
    } // END function - handleFetchUserProfileFromTwitter

    if (twitterApiClient && !user.profile_image_url) {
      logger.debug(
        'About to call Twitter API: /users/show.json?user_id=' + user.twitter_id
      )
      twitterApiClient.get(
        '/users/show.json',
        { user_id: user.twitter_id },
        handleFetchUserProfileFromTwitter
      )
      setTimeout(function () {
        if (!responseAlreadySent) {
          logger.debug(
            'Timing out Twitter API call after %d milliseconds and sending partial response.',
            config.twitter.timeout_ms
          )
          responseAlreadySent = true
          sendUserJson()
        }
      }, config.twitter.timeout_ms)
    } else {
      console.log('about to send user JSON!')
      sendUserJson()
    }
  } // END function - handleFindUser

  const handleError = function (error) {
    switch (error) {
      case ERRORS.USER_NOT_FOUND:
        res.status(404).json({ status: 404, msg: 'User not found.' })
        return
      case ERRORS.CANNOT_GET_USER:
        res.status(500).json({ status: 500, msg: 'Error finding user.' })
        return
      case ERRORS.UNAUTHORISED_ACCESS:
        res
          .status(401)
          .json({ status: 401, msg: 'User with that login token not found.' })
        return
      default:
        res.status(500).end()
    }
  }

  const findUserByLoginToken = async function (loginToken) {
    let user
    try {
      user = await User.findOne({
        where: { login_tokens: { [Op.contains]: [loginToken] } }
      })
    } catch (err) {
      logger.error(err)
      throw new Error(ERRORS.CANNOT_GET_USER)
    }

    if (!user) {
      throw new Error(ERRORS.UNAUTHORISED_ACCESS)
    }
    return user
  }

  const findUserById = async function (userId) {
    let user
    try {
      user = await User.findOne({ where: { id: userId } })
    } catch (err) {
      logger.error(err)
      throw new Error(ERRORS.CANNOT_GET_USER)
    }

    if (!user) {
      throw new Error(ERRORS.USER_NOT_FOUND)
    }
    return user
  }

  if (req.loginToken) {
    findUserByLoginToken(req.loginToken)
      .then(handleFindUser)
      .catch(handleError)
  } else {
    findUserById(userId)
      .then(handleFindUser)
      .catch(handleError)
  }
} // END function - exports.get

exports.delete = async function (req, res) {
  const userId = req.params.user_id
  let user
  try {
    user = await User.findByPk(userId)
  } catch (err) {
    logger.error(err)
    res.status(500).json({ status: 500, msg: 'Error finding user.' })
  }

  if (!user) {
    res.status(404).json({ status: 404, msg: 'User not fouloginTokennd.' })
    return
  }

  const idx = user.login_tokens.indexOf(req.loginToken)
  if (idx === -1) {
    res.status(401).end()
    return
  }
  user.login_tokens.splice(idx, 1)
  User.update(user, { where: { id: user.id }, returning: true })
    .then((result) => {
      res.status(204).end()
    })
    .catch((err) => {
      logger.error(err)
      res.status(500).json({ status: 500, msg: 'Could not sign-out user.' })
    })
} // END function - exports.delete

exports.put = async function (req, res) {
  let body
  try {
    body = req.body
  } catch (e) {
    res.status(400).json({ status: 400, msg: 'Could not parse body as JSON.' })
    return
  }

  const userId = req.params.user_id
  let user

  try {
    user = await User.findByPk(userId)
  } catch (err) {
    logger.error(err)
    res.status(500).json({ status: 500, msg: 'Error finding user.' })
  }

  if (!user) {
    res.status(404).json({ status: 404, msg: 'User not found.' })
    return
  }

  if (user.login_tokens.indexOf(req.loginToken) === -1) {
    res.status(401).end()
    return
  }

  user.data = body.data || user.data || {}
  User.update(user, { where: { id: user.id }, returning: true })
    .then((result) => {
      res.status(204).end()
    })
    .catch((err) => {
      logger.error(err)
      res
        .status(500)
        .json({ status: 500, msg: 'Could not update user information.' })
    })
} // END function - exports.put

exports.logout = async function (req, res) {
  // Flag error if user ID is not provided
  if (!req.params.user_id) {
    res.status(400).json({ status: 400, msg: 'Please provide user ID.' })
    return
  }

  const userId = req.params.user_id

  let user

  try {
    user = await User.findOne({ where: { id: userId } })
  } catch (err) {
    logger.error(err)
    res.status(500).json({ status: 500, msg: 'Error finding user.' })
  }

  if (!user) {
    res.status(404).json({ status: 404, msg: 'User not found.' })
    return
  }

  const idx = user.login_tokens.indexOf(req.loginToken)
  if (idx === -1) {
    res.status(401).end()
    return
  }
  user.login_tokens.splice(idx, 1)

  User.update(user, { where: { id: userId }, returning: true })
    .then((user) => {
      res.status(204).end()
    })
    .catch((err) => {
      logger.error(err)
      res.status(500).json({ status: 500, msg: 'Could not sign-out user.' })
    })
} // END function - exports.delete
