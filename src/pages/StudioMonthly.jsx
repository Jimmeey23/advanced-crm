import React from 'react'
import StudioPerformancePage from '../components/StudioPerformancePage.jsx'

export default function StudioMonthly() {
  return (
    <StudioPerformancePage
      range="month"
      title="Monthly studio performance"
      desc="Detailed month-by-month breakdown per studio — leads, trials, wins, revenue and follow-up discipline."
    />
  )
}
