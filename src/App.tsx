import { useEffect, useMemo, useRef, useState } from 'react'
import Matter from 'matter-js'
import confetti from 'canvas-confetti'

type GameState = 'MENU' | 'PLAYING' | 'GAME_OVER'
type ModalState = 'NONE' | 'SUCCESS' | 'FAIL' | 'INSUFFICIENT' | 'POWERUPS'

type Layout = {
  width: number
  height: number
  gridSize: number
  gridX: number
  gridY: number
  poolY: number
  poolHeight: number
  poolWidth: number
  poolX: number
}

type SlotInfo = {
  row: number
  col: number
  index: number
  value: number
}

type SlotCenter = SlotInfo & { x: number; y: number }

type BarrageMessage = {
  id: number
  text: string
  top: number
  duration: number
}

type OutcomeState = 'NONE' | 'SUCCESS' | 'FAIL'

const LEVEL_COUNT = 8
const MIN_GRID_SIZE = 3
const MAX_GRID_SIZE = 14

const LEVEL_SUCCESS_MESSAGES: Record<number, string> = {
  1: 'Amazing start!',
  2: "You're on fire!",
  3: 'Genius move!',
  4: 'Incredible work!',
  5: 'Unstoppable!',
  6: 'Mind-blowing!',
  7: 'Legendary!',
  8: "You're a master!",
}

const LEVEL_FAIL_MESSAGES: Record<number, string> = {
  1: 'Keep trying!',
  2: 'You can do it!',
  3: 'Stay focused!',
  4: 'Almost there!',
  5: "Don't give up!",
  6: 'Try again!',
  7: 'So close!',
  8: 'One more time!',
}

const colors = ['#34d399', '#60a5fa', '#facc15', '#f472b6', '#22d3ee', '#a78bfa']

const createSeededRandom = (seed: number) => {
  let value = seed % 2147483647
  if (value <= 0) value += 2147483646
  return () => (value = (value * 48271) % 2147483647) / 2147483647
}

const shuffle = <T,>(arr: T[], rand: () => number) => {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const getGridSizeForLevel = (levelIndex: number) =>
  Math.min(MAX_GRID_SIZE, MIN_GRID_SIZE + levelIndex - 1)

const generateSolvedGrid = (size: number, seed: number, levelIndex: number) => {
  const rand = createSeededRandom(seed + levelIndex * 131)
  const baseRow = Array.from({ length: size }, (_, i) => i + 1)
  const rowOrder = shuffle(baseRow.map((_, i) => i), rand)
  const colOrder = shuffle(baseRow.map((_, i) => i), rand)
  const symbols = shuffle(baseRow, rand)
  const map = new Map<number, number>()
  symbols.forEach((value, index) => map.set(index + 1, value))

  return rowOrder.map((r) =>
    colOrder.map((c) => map.get(((r + c) % size) + 1) ?? ((r + c) % size) + 1),
  )
}

const getMissingRatio = (levelIndex: number) => {
  if (levelIndex <= 3) return [0.22, 0.3]
  if (levelIndex <= 8) return [0.35, 0.5]
  return [0.55, 0.7]
}

const generateLevelData = (levelIndex: number, seed: number) => {
  const rng = createSeededRandom(seed + levelIndex * 97)
  const size = getGridSizeForLevel(levelIndex)
  const solvedGrid = generateSolvedGrid(size, seed, levelIndex)
  const grid = solvedGrid.map((row) => [...row])

  const [minRatio, maxRatio] = getMissingRatio(levelIndex)
  const missingCount = Math.floor(size * size * (minRatio + rng() * (maxRatio - minRatio)))

  const positions = Array.from({ length: size * size }, (_, i) => i)
  const shuffled = shuffle(positions, rng)
  shuffled.slice(0, missingCount).forEach((pos) => {
    const row = Math.floor(pos / size)
    const col = pos % size
    grid[row][col] = 0
  })

  return { size, solvedGrid, puzzleGrid: grid }
}

const getLevelReward = (levelIndex: number) => levelIndex * 5

function App() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const renderRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<Matter.Engine | null>(null)
  const ballValuesRef = useRef<Map<number, number>>(new Map())
  const slotCentersRef = useRef<SlotCenter[]>([])
  const solvedSlotsRef = useRef<Set<number>>(new Set())
  const bodyToSlotRef = useRef<Map<number, number>>(new Map())
  const slotToBodyRef = useRef<Map<number, number>>(new Map())
  const originalGravityRef = useRef<number>(1.1)

  const [gameState, setGameState] = useState<GameState>('MENU')
  const [modalState, setModalState] = useState<ModalState>('NONE')
  const [currentLevel, setCurrentLevel] = useState(1)
  const [menuLevel, setMenuLevel] = useState(6)
  const [showLevelPicker, setShowLevelPicker] = useState(false)
  const [score, setScore] = useState(0)
  const [sessionStart, setSessionStart] = useState<number | null>(null)
  const [sessionElapsed, setSessionElapsed] = useState(0)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [isLevelClaimed, setIsLevelClaimed] = useState(false)
  const [seed, setSeed] = useState(1)
  const [bannerMessage, setBannerMessage] = useState('')
  const [scoreDelta, setScoreDelta] = useState<number | null>(null)
  const [scoreFlash, setScoreFlash] = useState(false)
  const [barrageMessages, setBarrageMessages] = useState<BarrageMessage[]>([])
  const [levelOutcome, setLevelOutcome] = useState<OutcomeState>('NONE')
  const barrageIdRef = useRef(1)
  const levelTapCountRef = useRef(0)
  const levelTapTimeoutRef = useRef<number | null>(null)
  const [layout, setLayout] = useState<Layout>({
    width: 0,
    height: 640,
    gridSize: 0,
    gridX: 0,
    gridY: 0,
    poolY: 0,
    poolHeight: 0,
    poolWidth: 0,
    poolX: 0,
  })

  const levelData = useMemo(() => generateLevelData(currentLevel, seed), [currentLevel, seed])
  const puzzleGrid = levelData.puzzleGrid
  const solvedGrid = levelData.solvedGrid
  const gridSize = levelData.size
  const gridCells = useMemo(() => Array.from({ length: gridSize * gridSize }, (_, i) => i), [gridSize])
  const levelReward = getLevelReward(currentLevel)

  const slotInfo = useMemo<SlotInfo[]>(() => {
    const rows = puzzleGrid.length
    const cols = puzzleGrid[0].length
    const result: SlotInfo[] = []

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (puzzleGrid[r][c] !== 0) continue
        result.push({ row: r, col: c, index: r * cols + c, value: solvedGrid[r][c] })
      }
    }

    return result
  }, [puzzleGrid, solvedGrid])

  useEffect(() => {
    if (sessionStart !== null) return
    setSessionStart(Date.now())
  }, [sessionStart])

  useEffect(() => {
    if (sessionStart === null || sessionEnded) return undefined
    const intervalId = window.setInterval(() => {
      setSessionElapsed(Math.floor((Date.now() - sessionStart) / 1000))
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [sessionStart, sessionEnded])

  useEffect(() => {
    return () => {
      if (levelTapTimeoutRef.current) {
        window.clearTimeout(levelTapTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const updateLayout = () => {
      const screenWidth = window.innerWidth
      const screenHeight = window.innerHeight
      const width = Math.min(980, Math.max(300, screenWidth - (screenWidth < 520 ? 12 : 24)))

      const hudHeight = screenWidth < 520 ? 180 : screenWidth < 640 ? 150 : 120
      const verticalPadding = 24
      const availableHeight = Math.max(420, screenHeight - hudHeight - verticalPadding)

      const height = Math.min(Math.round(width * 1.15), availableHeight)
      const density = Math.min(1, Math.max(0, (gridSize - MIN_GRID_SIZE) / (MAX_GRID_SIZE - MIN_GRID_SIZE)))
      const gridY = Math.max(10, Math.round(height * 0.03))
      const gutter = Math.max(8, Math.round(height * (0.05 - density * 0.02)))
      const minPoolHeight = screenWidth < 520 ? 80 : 100
      const maxGridHeight = height - gridY - gutter - minPoolHeight
      const gridWidthScale = screenWidth < 520 ? 0.9 : 0.78
      const gridHeightScale = 0.62 + density * 0.16
      const gridSizePx = Math.max(
        180,
        Math.min(
          Math.round(width * gridWidthScale),
          Math.round(height * gridHeightScale),
          Math.round(maxGridHeight),
        ),
      )
      const gridX = Math.round((width - gridSizePx) / 2)
      const poolY = gridY + gridSizePx + gutter
      const poolHeight = Math.max(minPoolHeight, height - poolY - gutter)
      const poolWidth = width
      const poolX = 0

      setLayout({
        width,
        height,
        gridSize: gridSizePx,
        gridX,
        gridY,
        poolY,
        poolHeight,
        poolWidth,
        poolX,
      })
    }

    updateLayout()
    window.addEventListener('resize', updateLayout)
    return () => window.removeEventListener('resize', updateLayout)
  }, [gridSize])

    const pushBarrage = (text: string) => {
    const id = barrageIdRef.current
    barrageIdRef.current += 1
    const top = Math.round(8 + Math.random() * 40)
    const duration = 9000 + Math.round(Math.random() * 3000)
    setBarrageMessages((prev) => [...prev, { id, text, top, duration }])
    window.setTimeout(() => {
      setBarrageMessages((prev) => prev.filter((msg) => msg.id !== id))
    }, duration + 200)
  }

  useEffect(() => {
    if (modalState === 'SUCCESS') {
      const burst = () => {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } })
        confetti({ particleCount: 80, spread: 120, origin: { x: 0.2, y: 0.4 } })
        confetti({ particleCount: 80, spread: 120, origin: { x: 0.8, y: 0.4 } })
      }
      burst()
      const message = LEVEL_SUCCESS_MESSAGES[currentLevel] ?? 'Amazing!'
      setBannerMessage(message)
      pushBarrage(message)

      if (!isLevelClaimed) {
        setScore((prev) => prev + levelReward)
        setIsLevelClaimed(true)
        setScoreDelta(levelReward)
        setScoreFlash(true)
        window.setTimeout(() => {
          setScoreDelta(null)
          setScoreFlash(false)
        }, 2000)
      }

      return undefined
    }

    if (modalState === 'FAIL') {
      const message = LEVEL_FAIL_MESSAGES[currentLevel] ?? 'Try again!'
      setBannerMessage(message)
      pushBarrage(message)
      return undefined
    }

    if (modalState === 'NONE') {
      setBannerMessage('')
    }

    return undefined
  }, [modalState, isLevelClaimed, levelReward])

  useEffect(() => {
    if (gameState !== 'PLAYING') return
    const mount = renderRef.current
    if (!mount || layout.width === 0) return

    const { Engine, Render, Runner, World, Bodies, Events, Body, Query } = Matter

    const engine = Engine.create()
    engine.gravity.y = 1.1
    originalGravityRef.current = engine.gravity.y
    engineRef.current = engine
    solvedSlotsRef.current = new Set()
    ballValuesRef.current = new Map()
    bodyToSlotRef.current = new Map()
    slotToBodyRef.current = new Map()

    const render = Render.create({
      element: mount,
      engine,
      options: {
        width: layout.width,
        height: layout.height,
        wireframes: false,
        background: 'transparent',
        pixelRatio: window.devicePixelRatio,
      },
    })
    render.canvas.style.width = `${layout.width}px`
    render.canvas.style.height = `${layout.height}px`

    const wallThickness = 40
    const walls = [
      Bodies.rectangle(
        layout.width / 2,
        layout.height + wallThickness / 2,
        layout.width + wallThickness * 2,
        wallThickness,
        { isStatic: true, render: { fillStyle: '#0f172a' } },
      ),
      Bodies.rectangle(
        -wallThickness / 2,
        layout.height / 2,
        wallThickness,
        layout.height * 2,
        { isStatic: true, render: { fillStyle: '#0f172a' } },
      ),
      Bodies.rectangle(
        layout.width + wallThickness / 2,
        layout.height / 2,
        wallThickness,
        layout.height * 2,
        { isStatic: true, render: { fillStyle: '#0f172a' } },
      ),
    ]

    const gridGap = Math.max(3, Math.floor(layout.gridSize * 0.02))
    const cellSize = (layout.gridSize - gridGap * (gridSize - 1)) / gridSize
    const slotCenters: SlotCenter[] = slotInfo.map((slot) => ({
      ...slot,
      x: Math.round(layout.gridX + slot.col * (cellSize + gridGap) + cellSize / 2),
      y: Math.round(layout.gridY + slot.row * (cellSize + gridGap) + cellSize / 2),
    }))
    slotCentersRef.current = slotCenters

    const ballRadius = Math.max(12, Math.floor(cellSize * 0.42))
    const poolWallHeight = layout.poolHeight + ballRadius * 2
    const poolWallThickness = Math.max(22, Math.round(ballRadius * 1.4))
    const funnelHeight = Math.max(120, Math.round(ballRadius * 6))
    const funnelWidth = Math.max(14, Math.round(ballRadius * 1.1))
    const funnelInset = Math.round(ballRadius * 0.6)

    const poolWalls = [
      Bodies.rectangle(
        layout.width / 2,
        layout.poolY + layout.poolHeight + 14,
        layout.poolWidth + poolWallThickness * 0.6,
        28,
        { isStatic: true, render: { fillStyle: '#0b1120' } },
      ),
      Bodies.rectangle(
        layout.poolX - poolWallThickness / 2,
        layout.poolY + layout.poolHeight / 2 - ballRadius,
        poolWallThickness,
        poolWallHeight,
        { isStatic: true, render: { fillStyle: '#0b1120' } },
      ),
      Bodies.rectangle(
        layout.poolX + layout.poolWidth + poolWallThickness / 2,
        layout.poolY + layout.poolHeight / 2 - ballRadius,
        poolWallThickness,
        poolWallHeight,
        { isStatic: true, render: { fillStyle: '#0b1120' } },
      ),
      Bodies.rectangle(
        layout.poolX - funnelInset,
        layout.poolY - funnelHeight * 0.35,
        funnelWidth,
        funnelHeight,
        {
          isStatic: true,
          angle: -0.55,
          render: { fillStyle: '#0b1120' },
        },
      ),
      Bodies.rectangle(
        layout.poolX + layout.poolWidth + funnelInset,
        layout.poolY - funnelHeight * 0.35,
        funnelWidth,
        funnelHeight,
        {
          isStatic: true,
          angle: 0.55,
          render: { fillStyle: '#0b1120' },
        },
      ),
    ]
    const columns = Math.max(3, Math.floor(layout.poolWidth / (ballRadius * 2.2)))
    const balls = slotCenters.map((slot, index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      const x = layout.poolX + ballRadius + col * ballRadius * 2.1
      const y = layout.poolY + ballRadius + row * ballRadius * 2.1
      return Bodies.circle(
        Math.min(layout.poolX + layout.poolWidth - ballRadius, x),
        Math.min(layout.poolY + layout.poolHeight - ballRadius, y),
        ballRadius,
        {
          restitution: 0.7,
          friction: 0.1,
          density: 0.002,
          render: {
            fillStyle: colors[(slot.value - 1) % colors.length],
            strokeStyle: '#334155',
            lineWidth: 2,
          },
        },
      )
    })

    balls.forEach((body, index) => {
      ballValuesRef.current.set(body.id, slotCenters[index].value)
    })

    World.add(engine.world, [...walls, ...poolWalls, ...balls])

    render.canvas.style.pointerEvents = 'auto'
    render.canvas.style.touchAction = 'none'
    const preventTouch = (event: TouchEvent) => event.preventDefault()
    render.canvas.addEventListener('touchstart', preventTouch, { passive: false })
    render.canvas.addEventListener('touchmove', preventTouch, { passive: false })
    render.canvas.addEventListener('touchend', preventTouch, { passive: false })

    const snapThreshold = cellSize * 0.75

    const clearSlot = (slotIndex: number) => {
      const bodyId = slotToBodyRef.current.get(slotIndex)
      if (!bodyId) return
      slotToBodyRef.current.delete(slotIndex)
      bodyToSlotRef.current.delete(bodyId)
      solvedSlotsRef.current.delete(slotIndex)
    }

    const evaluateGrid = () => {
      if (slotToBodyRef.current.size !== slotCenters.length) return
      const filledGrid = puzzleGrid.map((row) => [...row])
      slotCenters.forEach((slot) => {
        const bodyId = slotToBodyRef.current.get(slot.index)
        const value = bodyId ? ballValuesRef.current.get(bodyId) : 0
        filledGrid[slot.row][slot.col] = value ?? 0
      })

      let isValid = true
      const size = gridSize
      const expectedCount = size

      for (let r = 0; r < size && isValid; r += 1) {
        const seen = new Set<number>()
        for (let c = 0; c < size; c += 1) {
          const value = filledGrid[r][c]
          if (!value || value < 1 || value > size || seen.has(value)) {
            isValid = false
            break
          }
          seen.add(value)
        }
        if (seen.size !== expectedCount) isValid = false
      }

      for (let c = 0; c < size && isValid; c += 1) {
        const seen = new Set<number>()
        for (let r = 0; r < size; r += 1) {
          const value = filledGrid[r][c]
          if (!value || value < 1 || value > size || seen.has(value)) {
            isValid = false
            break
          }
          seen.add(value)
        }
        if (seen.size !== expectedCount) isValid = false
      }

      if (isValid) {
        setModalState('SUCCESS')
        setLevelOutcome('SUCCESS')
      } else {
        setModalState('FAIL')
        setLevelOutcome('FAIL')
      }
    }

    const dropBody = (body: Matter.Body) => {
      let nearestDistance = Number.POSITIVE_INFINITY
      const nearest = slotCenters.reduce<SlotCenter | undefined>((closest, slot) => {
        const dx = body.position.x - slot.x
        const dy = body.position.y - slot.y
        const dist = Math.hypot(dx, dy)
        if (dist < nearestDistance) {
          nearestDistance = dist
          return slot
        }
        return closest
      }, undefined)

      if (!nearest || nearestDistance > snapThreshold) {
        // Return ball to pool instead of leaving it static or stuck
        Body.setStatic(body, false)
        Body.setPosition(body, {
          x: layout.poolX + Math.random() * layout.poolWidth,
          y: layout.poolY + Math.random() * layout.poolHeight * 0.4,
        })
        Body.setVelocity(body, { x: 0, y: 0 })
        return
      }

      if (slotToBodyRef.current.has(nearest.index)) {
        const existingId = slotToBodyRef.current.get(nearest.index)
        if (existingId && existingId !== body.id) {
          const existingBody = balls.find((b) => b.id === existingId)
          if (existingBody) {
            Body.setStatic(existingBody, false)
            Body.setPosition(existingBody, {
              x: layout.poolX + layout.poolWidth / 2,
              y: layout.poolY + 20,
            })
          }
        }
        clearSlot(nearest.index)
      }

      Body.setPosition(body, { x: nearest.x, y: nearest.y })
      Body.setVelocity(body, { x: 0, y: 0 })
      Body.setStatic(body, true)

      slotToBodyRef.current.set(nearest.index, body.id)
      bodyToSlotRef.current.set(body.id, nearest.index)
      solvedSlotsRef.current.add(nearest.index)

      evaluateGrid()
    }

    let dragBody: Matter.Body | null = null
    const toWorld = (event: PointerEvent) => {
      const rect = render.canvas.getBoundingClientRect()
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      const point = toWorld(event)
      const found = Query.point(balls, point)[0]
      if (!found) return
      dragBody = found
      const slotIndex = bodyToSlotRef.current.get(found.id)
      if (slotIndex !== undefined) {
        clearSlot(slotIndex)
      }
      Body.setStatic(found, true)
      Body.setPosition(found, point)
      Body.setVelocity(found, { x: 0, y: 0 })
      render.canvas.setPointerCapture?.(event.pointerId)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragBody) return
      const point = toWorld(event)
      Body.setPosition(dragBody, point)
      Body.setVelocity(dragBody, { x: 0, y: 0 })
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (!dragBody) return
      dropBody(dragBody)
      dragBody = null
      render.canvas.releasePointerCapture?.(event.pointerId)
    }

    render.canvas.addEventListener('pointerdown', handlePointerDown)
    render.canvas.addEventListener('pointermove', handlePointerMove)
    render.canvas.addEventListener('pointerup', handlePointerUp)
    render.canvas.addEventListener('pointercancel', handlePointerUp)

    const lockSnapped = () => {
      slotCenters.forEach((slot) => {
        const bodyId = slotToBodyRef.current.get(slot.index)
        if (!bodyId) return
        const body = balls.find((b) => b.id === bodyId)
        if (!body) return
        if (!body.isStatic) return
        const targetX = slot.x
        const targetY = slot.y
        if (body.position.x !== targetX || body.position.y !== targetY) {
          Body.setPosition(body, { x: targetX, y: targetY })
          Body.setVelocity(body, { x: 0, y: 0 })
        }
      })
    }

    Events.on(engine, 'beforeUpdate', lockSnapped)

    Events.on(render, 'afterRender', () => {
      const ctx = render.context
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `bold ${Math.max(12, Math.floor(ballRadius * 1.05))}px "Space Grotesk", "Inter", system-ui, sans-serif`
      ctx.fillStyle = '#0f172a'

      balls.forEach((b) => {
        const value = ballValuesRef.current.get(b.id)
        if (!value) return
        ctx.fillText(String(value), b.position.x, b.position.y + 1)
      })
      ctx.restore()
    })

    const runner = Runner.create()
    Runner.run(runner, engine)
    Render.run(render)

    return () => {
      Events.off(engine, 'beforeUpdate', lockSnapped)
      render.canvas.removeEventListener('touchstart', preventTouch)
      render.canvas.removeEventListener('touchmove', preventTouch)
      render.canvas.removeEventListener('touchend', preventTouch)
      render.canvas.removeEventListener('pointerdown', handlePointerDown)
      render.canvas.removeEventListener('pointermove', handlePointerMove)
      render.canvas.removeEventListener('pointerup', handlePointerUp)
      render.canvas.removeEventListener('pointercancel', handlePointerUp)
      Render.stop(render)
      Runner.stop(runner)
      World.clear(engine.world, false)
      Matter.Engine.clear(engine)
      render.canvas.remove()
      render.textures = {}
    }
  }, [gameState, layout, slotInfo, gridSize])

  const startGame = (level = 1) => {
    const now = Date.now()
    if (sessionEnded) {
      setSessionStart(now)
      setSessionElapsed(0)
      setSessionEnded(false)
    }
    setSeed(now)
    setScore(0)
    setCurrentLevel(level)
    setIsLevelClaimed(false)
    setModalState('NONE')
    setLevelOutcome('NONE')
    setBarrageMessages([])
    setGameState('PLAYING')
  }

  const exitToMenu = () => {
    setModalState('NONE')
    setLevelOutcome('NONE')
    setBarrageMessages([])
    setGameState('MENU')
  }

  const goNextLevel = () => {
    if (currentLevel >= LEVEL_COUNT) {
      if (sessionStart !== null) {
        setSessionElapsed(Math.floor((Date.now() - sessionStart) / 1000))
      }
      setSessionEnded(true)
      setModalState('NONE')
      setLevelOutcome('NONE')
      setBarrageMessages([])
      setGameState('GAME_OVER')
      return
    }
    setCurrentLevel((prev) => Math.min(LEVEL_COUNT, prev + 1))
    setIsLevelClaimed(false)
    setModalState('NONE')
    setScoreDelta(null)
    setScoreFlash(false)
    setLevelOutcome('NONE')
    setBarrageMessages([])
    setGameState('PLAYING')
  }

  const restartGame = () => {
    setScore(0)
    setCurrentLevel(1)
    setIsLevelClaimed(false)
    const now = Date.now()
    setSeed(now)
    setModalState('NONE')
    setLevelOutcome('NONE')
    setBarrageMessages([])
    setSessionStart(now)
    setSessionElapsed(0)
    setSessionEnded(false)
    setGameState('PLAYING')
  }

  const retryLevel = () => {
    const now = Date.now()
    setSeed(now)
    setIsLevelClaimed(false)
    setModalState('NONE')
    setLevelOutcome('NONE')
    setScoreDelta(null)
    setScoreFlash(false)
    setBarrageMessages([])
    setGameState('PLAYING')
  }

  const usePowerUpAutoFill = () => {
    const cost = Math.max(1, Math.ceil(score * 0.5))
    if (score < cost) {
      setModalState('INSUFFICIENT')
      return
    }
    setScore((prev) => prev - cost)
    setLevelOutcome('NONE')
    setModalState('POWERUPS')
  }

  const applyPowerup = (type: 'AUTO_FILL' | 'SHUFFLE' | 'CALM') => {
    if (!engineRef.current) return

    if (type === 'AUTO_FILL') {
      const bodies = Matter.Composite.allBodies(engineRef.current.world)
      
      // First, reset all balls to the pool
      const snappedBodyIds = Array.from(bodyToSlotRef.current.keys())
      snappedBodyIds.forEach((bodyId) => {
        const body = bodies.find((b) => b.id === bodyId)
        if (!body) return
        
        // Make ball non-static and return to pool
        Matter.Body.setStatic(body, false)
        Matter.Body.setPosition(body, {
          x: layout.poolX + Math.random() * layout.poolWidth,
          y: layout.poolY + Math.random() * layout.poolHeight * 0.5,
        })
        Matter.Body.setVelocity(body, { x: 0, y: 0 })
        
        // Reset visual style
        const value = ballValuesRef.current.get(body.id)
        if (value !== undefined) {
          const colorIndex = (value - 1) % colors.length
          body.render.fillStyle = colors[colorIndex]
          body.render.strokeStyle = colors[colorIndex]
        }
      })
      
      // Clear all slot mappings
      slotToBodyRef.current.clear()
      bodyToSlotRef.current.clear()
      solvedSlotsRef.current.clear()
      
      // Then auto-fill one number
      const targetSlot = slotCentersRef.current.find((slot) => !slotToBodyRef.current.has(slot.index))
      if (!targetSlot) return
      
      const body = bodies.find((b) => !b.isStatic && ballValuesRef.current.get(b.id) === targetSlot.value)
      if (!body) return
      
      Matter.Body.setPosition(body, { x: targetSlot.x, y: targetSlot.y })
      Matter.Body.setVelocity(body, { x: 0, y: 0 })
      Matter.Body.setStatic(body, true)
      slotToBodyRef.current.set(targetSlot.index, body.id)
      bodyToSlotRef.current.set(body.id, targetSlot.index)
      solvedSlotsRef.current.add(targetSlot.index)
      body.render.fillStyle = '#34d399'
      body.render.strokeStyle = '#bbf7d0'
    }

    if (type === 'SHUFFLE') {
      const bodies = Matter.Composite.allBodies(engineRef.current.world)
      bodies.forEach((b) => {
        if (b.isStatic || bodyToSlotRef.current.has(b.id)) return
        Matter.Body.setPosition(b, {
          x: layout.poolX + Math.random() * layout.poolWidth,
          y: layout.poolY + Math.random() * layout.poolHeight * 0.6,
        })
        Matter.Body.setVelocity(b, { x: 0, y: 0 })
      })
    }

    if (type === 'CALM') {
      engineRef.current.gravity.y = 0.2
      window.setTimeout(() => {
        if (engineRef.current) {
          engineRef.current.gravity.y = originalGravityRef.current
        }
      }, 6000)
    }

    setModalState('NONE')
    setLevelOutcome('NONE')
  }

  const showGame = gameState === 'PLAYING' || modalState !== 'NONE' || levelOutcome !== 'NONE'
  const isBlurred = modalState !== 'NONE' || levelOutcome !== 'NONE'
  const outcomeState: OutcomeState =
    levelOutcome !== 'NONE'
      ? levelOutcome
      : modalState === 'SUCCESS' || modalState === 'FAIL'
        ? modalState
        : 'NONE'
  const cellFontSize = Math.max(14, Math.floor((layout.gridSize / gridSize) * 0.55))
  const sessionTime = useMemo(() => {
    const hours = Math.floor(sessionElapsed / 3600)
    const minutes = Math.floor((sessionElapsed % 3600) / 60)
    const seconds = Math.floor(sessionElapsed % 60)
    return { hours, minutes, seconds }
  }, [sessionElapsed])

  const handleTitleTap = () => {
    levelTapCountRef.current += 1
    if (levelTapTimeoutRef.current) {
      window.clearTimeout(levelTapTimeoutRef.current)
    }
    levelTapTimeoutRef.current = window.setTimeout(() => {
      levelTapCountRef.current = 0
    }, 1200)
    if (levelTapCountRef.current >= 5) {
      setShowLevelPicker((prev) => !prev)
      levelTapCountRef.current = 0
      if (levelTapTimeoutRef.current) {
        window.clearTimeout(levelTapTimeoutRef.current)
        levelTapTimeoutRef.current = null
      }
    }
  }

  return (
    <div className="nature-bg text-slate-900">
      <div className="flex min-h-screen w-full flex-col">
        <div className="barrage-layer" aria-hidden="true">
          {barrageMessages.map((msg) => (
            <div
              key={msg.id}
              className="barrage-item"
              style={{ top: `${msg.top}%`, animationDuration: `${msg.duration}ms` }}
            >
              {msg.text}
            </div>
          ))}
        </div>
        {gameState === 'MENU' && (
          <div className="panel flex flex-1 flex-col items-center justify-center px-4 py-6 text-center gap-12">
            {/* Top Section: Welcome & Title */}
            <div className="flex flex-col items-center">
              <p className="text-xs uppercase tracking-[0.4em] text-emerald-700/70 mb-8">Welcome</p>
              <h1
                className="text-6xl font-black tracking-[0.2em] rainbow-text"
                onClick={handleTitleTap}
                role="button"
                aria-label="Toggle quick level selector"
              >
                SUDO-PHYSICS
              </h1>
            </div>

            {/* Middle Section: Score */}
            <div className="flex flex-col items-center">
              <div className="text-xs uppercase tracking-[0.35em] text-emerald-700/60 mb-8">Total Score</div>
              <div className="score-display-box">
                <span className="score-number">{score}</span>
              </div>
            </div>

            {/* Bottom Section: Level Picker & Button */}
            <div className="flex flex-col items-center gap-8">
              {showLevelPicker && (
                <div className="flex flex-col items-center gap-3">
                  <div className="text-xs uppercase tracking-[0.35em] text-emerald-700/60">Quick Level</div>
                  <select
                    value={menuLevel}
                    onChange={(event) => setMenuLevel(Number(event.target.value))}
                    className="rounded-full border border-emerald-200 bg-white/80 px-5 py-2 text-sm font-semibold text-emerald-900 shadow-sm"
                  >
                    {Array.from({ length: LEVEL_COUNT }, (_, index) => index + 1).map((level) => (
                      <option key={level} value={level}>
                        Level {level}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="button"
                onClick={() => startGame(showLevelPicker ? menuLevel : 1)}
                className="btn-primary"
              >
                Start Game
              </button>
            </div>
          </div>
        )}

        {showGame && (
          <div className="flex flex-1 flex-col overflow-hidden px-4 py-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-emerald-700/70">Peaceful Mode</p>
                <h2 className="text-2xl font-semibold text-emerald-950">
                  Level {currentLevel} · {gridSize}x{gridSize} Logic Grid
                </h2>
              </div>
              <div className="hud-chip">Reward: {levelReward} pts</div>
            </div>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
              <div className={`text-lg font-semibold text-amber-700 ${scoreFlash ? 'score-pulse' : ''}`}>
                Score: {score}
                {scoreDelta !== null && <span className="score-delta">+{scoreDelta}</span>}
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={exitToMenu} className="btn-secondary">
                  Exit to Menu
                </button>
              </div>
            </div>

            <div
              ref={containerRef}
              className={`panel game-panel relative mx-auto flex-1 ${isBlurred ? 'blur-[1.5px]' : ''}`}
              style={{ width: layout.width || '100%' }}
            >
              <div className="relative h-full" style={{ minHeight: layout.height || 640 }}>
                <div ref={renderRef} className="pointer-events-auto absolute inset-0" />

                <div className="pointer-events-none absolute inset-0">
                  <div
                    className="absolute"
                    style={{
                      left: layout.gridX,
                      top: layout.gridY,
                      width: layout.gridSize,
                      height: layout.gridSize,
                    }}
                  >
                    <div
                      className="grid h-full w-full"
                      style={{
                        gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                        gap: Math.max(3, Math.floor(layout.gridSize * 0.02)),
                      }}
                    >
                      {gridCells.map((cell) => {
                        const row = Math.floor(cell / gridSize)
                        const col = cell % gridSize
                        const value = puzzleGrid[row][col]
                        const isEmpty = value === 0
                        return (
                          <div key={cell} className={isEmpty ? 'cell cell-empty' : 'cell'}>
                            {!isEmpty && (
                              <span className="cell-text" style={{ fontSize: cellFontSize }}>
                                {value}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div 
                    className="pool-label-inside" 
                    style={{ 
                      top: layout.poolY + 10, 
                      left: layout.poolX + layout.poolWidth / 2 
                    }}
                  >
                    BALL POOL
                  </div>
                  <div
                    className="absolute pool"
                    style={{
                      left: layout.poolX,
                      top: layout.poolY,
                      width: layout.poolWidth,
                      height: layout.poolHeight,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {gameState === 'GAME_OVER' && (
          <div className="finale-screen flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
            <div className="finale-content">
              <p className="finale-kicker">Final Level Complete</p>
              <h2 className="finale-title">A Cosmic Journey Ends</h2>
              <p className="finale-message">
                Thank you for spending {sessionTime.hours} hours {sessionTime.minutes} minutes {sessionTime.seconds} seconds
                on this game. May every day be lucky for you!
              </p>
              <div className="finale-score">Final Score: {score}</div>
              <button type="button" onClick={restartGame} className="btn-primary">
                Play Again
              </button>
            </div>
          </div>
        )}
      </div>

      {(modalState !== 'NONE' || outcomeState !== 'NONE') && (
        <div className="modal-overlay">
          {outcomeState === 'SUCCESS' && (
            <div className="modal-card">
              <div className="banner">{bannerMessage}</div>
              <div className="dance">🕺 💃 🪩</div>
              <h3 className="text-2xl font-semibold text-emerald-900">Level {currentLevel} Complete!</h3>
              <p className="mt-2 text-sm text-emerald-900/70">
                You earned {levelReward} points
              </p>
              <div className="mt-3 text-base font-semibold text-amber-700">Total Score: {score}</div>
              <div className="mt-4 flex flex-col gap-3">
                <button type="button" onClick={goNextLevel} className="btn-primary">
                  {currentLevel === LEVEL_COUNT ? 'Finish Journey' : 'Next Level'}
                </button>
                <button type="button" onClick={exitToMenu} className="btn-tertiary">
                  Exit to Menu
                </button>
              </div>
            </div>
          )}

          {outcomeState === 'FAIL' && (
            <div className="modal-card">
              <div className="banner banner-warm">{bannerMessage}</div>
              <h3 className="text-2xl font-semibold text-rose-700">Not Quite</h3>
              <p className="mt-2 text-sm text-emerald-900/70">Stay calm and keep arranging.</p>
              <div className="mt-4 flex flex-col gap-3">
                <button type="button" onClick={retryLevel} className="btn-primary">
                  Retry Level
                </button>
                <button type="button" onClick={usePowerUpAutoFill} className="btn-secondary">
                  Use Power-up
                </button>
                <button type="button" onClick={exitToMenu} className="btn-tertiary">
                  Exit Game
                </button>
              </div>
            </div>
          )}

          {modalState === 'INSUFFICIENT' && (
            <div className="modal-card">
              <div className="banner banner-warm">Insufficient points, cannot claim reward</div>
              <h3 className="text-2xl font-semibold text-amber-700">Keep Going</h3>
              <p className="mt-2 text-sm text-emerald-900/70">Earn more points to use rewards.</p>
              <div className="mt-4 flex flex-col gap-3">
                <button type="button" onClick={exitToMenu} className="btn-tertiary">
                  Exit
                </button>
                <button type="button" onClick={() => setModalState('NONE')} className="btn-secondary">
                  Continue Game
                </button>
              </div>
            </div>
          )}

          {modalState === 'POWERUPS' && (
            <div className="modal-card">
              <div className="banner">Power-up Garden</div>
              <p className="mt-2 text-sm text-emerald-900/70">Auto-fill one correct number?</p>
              <div className="mt-4 flex flex-col gap-3">
                <button type="button" onClick={() => applyPowerup('AUTO_FILL')} className="btn-primary">
                  Auto-fill one number
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModalState('NONE')
                  }}
                  className="btn-tertiary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App