const config = require('config')
const uuid = require('uuid')
const { isArray } = require('lodash')
const { ERRORS, asStreetJson } = require('../../../lib/util')
const logger = require('../../../lib/logger.js')()
const { User, Sequelize, Street, Sequence } = require('../../db/models')

const Op = Sequelize.Op

exports.post = async function (req, res) {
  let body
  const street = {}

  street.id = uuid.v1()
  const requestIp = function (req) {
    if (req.headers['x-forwarded-for'] !== undefined) {
      return req.headers['x-forwarded-for'].split(', ')[0]
    } else {
      return req.connection.remoteAddress
    }
  }

  if (req.body) {
    try {
      body = req.body
    } catch (e) {
      res
        .status(400)
        .json({ status: 400, msg: 'Could not parse body as JSON.' })
      return
    }
    // TODO: Validation
    street.name = body.name
    street.namespaced_id = body.data.namespacedId
    street.client_updated_at = body.clientUpdatedAt
    street.data = body.data
    street.creator_ip = requestIp(req)
  }

  function handleErrors (error, foo) {
    switch (error) {
      case ERRORS.USER_NOT_FOUND:
        res.status(404).json({ status: 404, msg: 'User not found.' })
        return
      case ERRORS.STREET_NOT_FOUND:
        res.status(404).json({ status: 404, msg: 'Original street not found.' })
        return
      case ERRORS.CANNOT_CREATE_STREET:
        res
          .status(500)
          .json({ status: 500, msg: 'Could not create new street ID.' })
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

  function updateUserLastStreetId (userAltId) {
    return User.findOne({ where: { _id: userAltId } }).then((user) => {
      return user.increment('last_street_id', { by: 1 })
    })
  }

  async function updateSequence () {
    let sequence
    try {
      sequence = await Sequence.findByPk('streets')
    } catch (err) {
      logger.error(err)
      throw new Error(ERRORS.CANNOT_CREATE_STREET)
    }
    if (sequence) {
      return Sequence.update(
        { seq: sequence.seq + 1 },
        { where: { id: 'streets' }, returning: true }
      )
    }
    return Sequence.create({
      id: 'streets',
      seq: 1
    })
  }

  const makeNamespacedId = async function () {
    let namespacedId
    try {
      if (street.creator_id) {
        const user = await updateUserLastStreetId(street.creator_id)
        namespacedId = user && user.last_street_id ? user.last_street_id : 1
      } else {
        const sequence = await updateSequence()
        if (isArray(sequence)) {
          namespacedId = sequence[1][0].seq
        } else {
          namespacedId = sequence.seq
        }
      }
    } catch (err) {
      logger.error(err)
      throw new Error(ERRORS.CANNOT_CREATE_STREET)
    }

    if (!namespacedId) {
      throw new Error(ERRORS.CANNOT_CREATE_STREET)
    }
    return namespacedId
  }

  const saveStreet = async function () {
    if (body && body.originalStreetId) {
      let origStreet
      try {
        origStreet = await Street.findOne({
          where: { id: body.originalStreetId }
        })
      } catch (err) {
        logger.error(err)
        throw new Error(ERRORS.STREET_NOT_FOUND)
      }

      if (!origStreet || origStreet.status === 'DELETED') {
        throw new Error(ERRORS.STREET_NOT_FOUND)
      }
      const namespacedId = await makeNamespacedId()
      street.namespaced_id = namespacedId

      return Street.create(street)
    }

    const namespacedId = await makeNamespacedId()
    street.namespaced_id = namespacedId
    return Street.create(street)
  }

  const handleCreatedStreet = (s) => {
    s = asStreetJson(s)
    logger.info({ street: s }, 'New street created.')
    res.header('Location', config.restapi.baseuri + '/v1/streets/' + s.id)
    res.status(201).json(s)
  }

  if (req.loginToken) {
    let user
    try {
      user = await User.findOne({
        where: { login_tokens: { [Op.contains]: [req.loginToken] } }
      })
    } catch (err) {
      logger.error(err)
      handleErrors(ERRORS.USER_NOT_FOUND)
    }

    if (!user) {
      handleErrors(ERRORS.UNAUTHORISED_ACCESS)
    }
    street.creator_id = user ? user.id : ''
    saveStreet()
      .then(handleCreatedStreet)
      .catch(handleErrors)
  } else {
    saveStreet()
      .then(handleCreatedStreet)
      .catch(handleErrors)
  }
}

exports.delete = async function (req, res) {
  if (!req.loginToken) {
    res.status(401).end()
    return
  }

  if (!req.params.street_id) {
    res.status(400).json({ status: 400, msg: 'Please provide street ID.' })
    return
  }

  async function deleteStreet (street) {
    let user
    try {
      user = await User.findOne({
        where: { login_tokens: { [Op.contains]: [req.loginToken] } }
      })
    } catch (err) {
      logger.error(err)
      throw new Error(ERRORS.USER_NOT_FOUND)
    }

    if (!user) {
      throw new Error(ERRORS.UNAUTHORISED_ACCESS)
    }

    if (!street.creator_id) {
      throw new Error(ERRORS.FORBIDDEN_REQUEST)
    }

    if (street.creator_id.toString() !== user._id.toString()) {
      throw new Error(ERRORS.FORBIDDEN_REQUEST)
    }

    street.status = 'DELETED'
    return Street.update(street, {
      where: { id: req.params.street_id },
      returning: true
    })
  }

  function handleErrors (error) {
    switch (error) {
      case ERRORS.USER_NOT_FOUND:
        res.status(404).json({ status: 404, msg: 'User not found.' })
        return
      case ERRORS.STREET_NOT_FOUND:
        res.status(404).json({ status: 404, msg: 'Could not find street.' })
        return
      case ERRORS.UNAUTHORISED_ACCESS:
        res.status(401).json({ status: 401, msg: 'User is not signed-in.' })
        return
      case ERRORS.FORBIDDEN_REQUEST:
        res.status(403).json({
          status: 403,
          msg: 'Signed-in user cannot delete this street.'
        })
        return
      default:
        res.status(500).end()
    }
  }

  let street

  try {
    street = await Street.findOne({ where: { id: req.params.street_id } })
  } catch (err) {
    logger.error(err)
    handleErrors(ERRORS.STREET_NOT_FOUND)
  }

  if (!street) {
    res.status(204).end()
    return
  }

  deleteStreet(street)
    .then((street) => {
      res.status(204).end()
    })
    .catch(handleErrors)
} // END function - exports.delete

exports.get = async function (req, res) {
  if (!req.params.street_id) {
    res.status(400).json({ status: 400, msg: 'Please provide street ID.' })
    return
  }
  let street

  try {
    street = await Street.findOne({
      where: { id: req.params.street_id }
    })
  } catch (err) {
    logger.error(err)
    res.status(500).json({ status: 500, msg: 'Could not find street.' })
    return
  }

  if (!street) {
    res.status(404).json({ status: 404, msg: 'Could not find street.' })
    return
  }

  if (street.status === 'DELETED') {
    res.status(410).json({ status: 410, msg: 'Could not find street.' })
    return
  }

  res.header('Last-Modified', street.updated_at)
  if (req.method === 'HEAD') {
    res.status(204).end()
    return
  }
  street = asStreetJson(street)
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Location', config.restapi.baseuri + '/v1/streets/' + street.id)
  res.status(200).json(street)
} // END function - exports.get

exports.find = async function (req, res) {
  const creatorId = req.query.creatorId
  const namespacedId = req.query.namespacedId
  const start = (req.query.start && Number.parseInt(req.query.start, 10)) || 0
  const count = (req.query.count && Number.parseInt(req.query.count, 10)) || 20
  const findStreetWithCreatorId = async function (creatorId) {
    let user
    try {
      user = await User.findOne({ where: { id: creatorId } })
    } catch (err) {
      logger.error(err)
      handleErrors(ERRORS.USER_NOT_FOUND)
    }

    if (!user) {
      throw new Error(ERRORS.USER_NOT_FOUND)
    }
    return Street.findOne({
      where: { namespaced_id: namespacedId, creator_id: user.id }
    })
  } // END function - findStreetWithCreatorId

  const findStreetWithNamespacedId = async function (namespacedId) {
    return Street.findOne({
      where: { namespaced_id: namespacedId, creator_id: null }
    })
  }

  const findStreets = async function (start, count) {
    return Street.findAndCountAll({
      where: { status: 'ACTIVE' },
      order: [['updated_at', 'DESC']],
      offset: start,
      limit: count
    })
  } // END function - findStreets

  function handleErrors (error) {
    switch (error) {
      case ERRORS.USER_NOT_FOUND:
        res.status(404).json({ status: 404, msg: 'Creator not found.' })
        return
      case ERRORS.STREET_NOT_FOUND:
        res.status(404).json({ status: 404, msg: 'Could not find street.' })
        return
      case ERRORS.STREET_DELETED:
        res.status(410).json({ status: 410, msg: 'Could not find street.' })
        return
      case ERRORS.UNAUTHORISED_ACCESS:
        res.status(401).json({ status: 401, msg: 'User is not signed-in.' })
        return
      case ERRORS.FORBIDDEN_REQUEST:
        res.status(403).json({
          status: 403,
          msg: 'Signed-in user cannot delete this street.'
        })
        return
      default:
        res.status(500).end()
    }
  } // END function - handleErrors

  const handleFindStreet = function (street) {
    street = asStreetJson(street)
    if (!street) {
      handleErrors(ERRORS.STREET_NOT_FOUND)
    }

    if (street.status === 'DELETED') {
      handleErrors(ERRORS.STREET_DELETED)
    }
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Location', config.restapi.baseuri + '/v1/streets/' + street.id)
    res.set('Content-Length', 0)
    res.status(307).end()
  } // END function - handleFindStreet

  const handleFindStreets = function (results) {
    const totalNumStreets = results.count
    const streets = results.rows

    const selfUri =
      config.restapi.baseuri + '/v1/streets?start=' + start + '&count=' + count

    const json = {
      meta: {
        links: {
          self: selfUri
        }
      },
      streets: streets
    }

    if (start > 0) {
      let prevStart, prevCount
      if (start >= count) {
        prevStart = start - count
        prevCount = count
      } else {
        prevStart = 0
        prevCount = start
      }
      json.meta.links.prev =
        config.restapi.baseuri +
        '/v1/streets?start=' +
        prevStart +
        '&count=' +
        prevCount
    }

    if (start + streets.length < totalNumStreets) {
      const nextStart = start + count
      const nextCount = Math.min(
        count,
        totalNumStreets - start - streets.length
      )
      json.meta.links.next =
        config.restapi.baseuri +
        '/v1/streets?start=' +
        nextStart +
        '&count=' +
        nextCount
    }
    res.status(200).send(json)
  } // END function - handleFindStreets

  if (creatorId) {
    try {
      const street = await findStreetWithCreatorId(creatorId)
      handleFindStreet(street)
    } catch (err) {
      handleErrors(err)
    }
  } else if (namespacedId) {
    findStreetWithNamespacedId(namespacedId)
      .then(handleFindStreet)
      .catch(handleErrors)
  } else {
    findStreets(start, count)
      .then(handleFindStreets)
      .catch(handleErrors)
  }
}

exports.put = async function (req, res) {
  let body

  if (req.body) {
    try {
      body = req.body
    } catch (e) {
      res
        .status(400)
        .json({ status: 400, msg: 'Could not parse body as JSON.' })
      return
    }
  } else {
    res
      .status(400)
      .json({ status: 400, msg: 'Street information not specified.' })
    return
  }

  if (!req.params.street_id) {
    res.status(400).json({ status: 400, msg: 'Please provide street ID.' })
    return
  }

  function handleErrors (error) {
    switch (error) {
      case ERRORS.USER_NOT_FOUND:
        res.status(404).json({ status: 404, msg: 'Creator not found.' })
        return
      case ERRORS.STREET_NOT_FOUND:
        res.status(404).json({ status: 404, msg: 'Original street not found.' })
        return
      case ERRORS.STREET_DELETED:
        res.status(410).json({ status: 410, msg: 'Could not find street.' })
        return
      case ERRORS.CANNOT_UPDATE_STREET:
        res.status(500).json({ status: 500, msg: 'Could not update street.' })
        return
      case ERRORS.UNAUTHORISED_ACCESS:
        res.status(401).json({ status: 401, msg: 'User is not signed-in.' })
        return
      case ERRORS.FORBIDDEN_REQUEST:
        res.status(403).json({
          status: 403,
          msg: 'Signed-in user cannot update this street.'
        })
        return
      default:
        res.status(500).end()
    }
  } // END function - handleErrors

  async function updateStreetData (street) {
    street.name = body.name || street.name
    street.data = body.data || street.data
    street.client_updated_at =
      body.clientUpdatedAt || street.client_updated_at || ''

    if (body.originalStreetId) {
      let origStreet
      try {
        origStreet = await Street.findOne({
          where: { id: body.originalStreetId }
        })
      } catch (err) {
        logger.error(err)
        handleErrors(ERRORS.CANNOT_UPDATE_STREET)
      }

      if (!origStreet) {
        throw new Error(ERRORS.STREET_NOT_FOUND)
      }

      street.original_street_id = origStreet.id
      return street.save({ returning: true })
    } else {
      return street.save({ returning: true })
    }
  } // END function - updateStreetData

  let street
  try {
    street = await Street.findOne({
      where: { id: req.params.street_id }
    })
  } catch (err) {
    logger.error(err)
    handleErrors(ERRORS.CANNOT_UPDATE_STREET)
  }

  async function updateStreetWithCreatorId (street) {
    let user
    try {
      user = await User.findOne({
        where: { login_tokens: { [Op.contains]: [req.loginToken] } }
      })
    } catch (err) {
      logger.error(err)
      handleErrors(ERRORS.CANNOT_UPDATE_STREET)
    }

    if (!user) {
      throw new Error(ERRORS.UNAUTHORISED_ACCESS)
    }

    if (!street.creator_id) {
      throw new Error(ERRORS.FORBIDDEN_REQUEST)
    }

    if (street.creator_id.toString() !== user.id.toString()) {
      throw new Error(ERRORS.FORBIDDEN_REQUEST)
    }
    return updateStreetData(street)
  } // END function - updateStreetWithCreatorId

  if (!street) {
    handleErrors(ERRORS.STREET_NOT_FOUND)
    return
  }

  if (street.status === 'DELETED') {
    handleErrors(ERRORS.STREET_DELETED)
    return
  }

  if (!street.creator_id) {
    updateStreetData(street)
      .then((street) => {
        res.status(204).end()
      })
      .catch(handleErrors)
  } else {
    if (!req.loginToken) {
      res.status(401).end()
      return
    }
    updateStreetWithCreatorId(street)
      .then((street) => {
        res.status(204).end()
      })
      .catch(handleErrors)
  }
} // END function - exports.put
