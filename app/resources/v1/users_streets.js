const async = require('async')

require('../../../lib/db.js')
const User = require('../../models/user.js')
const Street = require('../../models/street.js')
const logger = require('../../../lib/logger.js')()
const { ERRORS } = require('../../../lib/util')

exports.get = async function (req, res) {
  // Flag error if user ID is not provided
  if (!req.params.user_id) {
    res.status(400).send('Please provide user ID.')
  }

  const findUserStreets = async function (userId) {
    try {
      const streets = await Street.find({ creator_id: userId, status: 'ACTIVE' })
        .sort({ updated_at: 'descending' })
        .exec()

      if (!streets) {
        throw new Error(ERRORS.STREET_NOT_FOUND)
      }
      return streets
    } catch (err) {
      logger.error(err)
      handleErrors(ERRORS.INTERNAL_ERROR)
    }
  } // END function - handleFindUserstreets

  const handleFindUserStreets = function (streets) {
    const json = { streets: [] }
    async.map(
      streets,
      function (street, callback) { street.asJson(callback) },
      function (err, results) {
        if (err) {
          logger.error(err)
          res.status(500).send('Could not append street.')
          return
        }

        json.streets = results
        res.status(200).send(json)
      }) // END - async.map
  } // END function - handleFindUserStreets

  function handleErrors (error) {
    switch (error) {
      case ERRORS.USER_NOT_FOUND:
        res.status(404).send('Creator not found.')
        return
      case ERRORS.STREET_NOT_FOUND:
        res.status(404).send('Could not find streets.')
        return
      case ERRORS.STREET_DELETED:
        res.status(410).send('Could not find street.')
        return
      case ERRORS.INTERNAL_ERROR:
        res.status(500).send('Could not find streets for user.')
        return
      case ERRORS.UNAUTHORISE_ACCESS:
        res.status(401).send('User is not signed-in.')
        return
      case ERRORS.FORBIDDEN_REQUEST:
        res.status(403).send('Signed-in user cannot delete this street.')
        return
      default:
        res.status(500).end()
    }
  } // END function - handleErrors

  try {
    const user = await User.findOne({ id: req.params.user_id })
    if (!user) {
      res.status(404).send('Could not find user.')
      return
    }
    findUserStreets(user._id)
      .then(handleFindUserStreets)
      .catch(handleErrors)
  } catch (err) {
    logger.error(err)
    handleErrors(ERRORS.USER_NOT_FOUND)
  }
}
