import { useState, useEffect } from 'react'
import PropTypes from 'prop-types'

const Typewriter = ({ text, delay = 30, onComplete, className = '' }) => {
    const [currentText, setCurrentText] = useState('')
    const [currentIndex, setCurrentIndex] = useState(0)

    useEffect(() => {
        if (currentIndex < text.length) {
            const timeout = setTimeout(() => {
                setCurrentText(prev => prev + text[currentIndex])
                setCurrentIndex(prev => prev + 1)
            }, delay)

            return () => clearTimeout(timeout)
        } else {
            if (onComplete) onComplete()
        }
    }, [currentIndex, delay, text, onComplete])

    return <span className={className}>{currentText}</span>
}

Typewriter.propTypes = {
    text: PropTypes.string.isRequired,
    delay: PropTypes.number,
    onComplete: PropTypes.func,
    className: PropTypes.string,
}

export default Typewriter
