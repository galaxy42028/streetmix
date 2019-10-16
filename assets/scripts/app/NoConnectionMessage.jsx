import React, { useRef, useLayoutEffect } from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { FormattedMessage } from 'react-intl'
import { nonblockingAjaxTryAgain } from '../util/fetch_nonblocking'

const NO_CONNECTION_MESSAGE_TIMEOUT = 10000

NoConnectionMessage.propTypes = {
  scheduled: PropTypes.bool.isRequired
}

function NoConnectionMessage ({ scheduled = false }) {
  const el = useRef(null)
  const timerId = useRef(-1)

  function cleanup () {
    window.clearTimeout(timerId.current)
    timerId.current = -1

    el.current.classList.remove('status-message-visible')
    document.body.classList.remove('no-connection-message-visible')

    // Do not allow keyboard focus on the button when offscreen
    el.current.querySelector('button').setAttribute('tabindex', '-1')
  }

  useLayoutEffect(() => {
    if (scheduled && timerId.current === -1) {
      timerId.current = window.setTimeout(() => {
        el.current.classList.add('status-message-visible')

        // Allow keyboard focus on the button when visible
        el.current.querySelector('button').setAttribute('tabindex', '0')

        // When this is visible, this class on the body element repositions the
        // normal status message above this one so that they don't overlap
        document.body.classList.add('no-connection-message-visible')
      }, NO_CONNECTION_MESSAGE_TIMEOUT)
    } else {
      cleanup()
    }

    return () => {
      cleanup()
    }
  })

  return (
    <div className="status-message" ref={el}>
      <div className="status-message-content">
        <FormattedMessage
          id="msg.no-connection"
          defaultMessage="Streetmix is having trouble connecting to the Internet."
        />
        <button onClick={nonblockingAjaxTryAgain} tabIndex="-1">
          <FormattedMessage id="btn.try-again" defaultMessage="Try again" />
        </button>
      </div>
    </div>
  )
}

function mapStateToProps (state) {
  return {
    scheduled: state.status.noConnectionMessage
  }
}

export default connect(mapStateToProps)(NoConnectionMessage)
