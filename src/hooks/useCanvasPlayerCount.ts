import { useEffect, useState } from 'react'
import {
  getActiveCanvasPlayerCount,
  subscribeCanvasPlayerCount,
} from '../lib/mediabunnyPlayer'

export function useCanvasPlayerCount(): number {
  const [count, setCount] = useState(getActiveCanvasPlayerCount)

  useEffect(() => subscribeCanvasPlayerCount(() => {
    setCount(getActiveCanvasPlayerCount())
  }), [])

  return count
}
