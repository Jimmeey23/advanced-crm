import React from 'react'
import StudioPerformancePage from '../components/StudioPerformancePage.jsx'

export default function StudioWeekly() {
  return (
    <StudioPerformancePage
      range="week"
      title="Weekly studio performance"
      desc="Detailed week-by-week breakdown per studio — leads, trials, wins, revenue and follow-up discipline."
    />
  )
}
