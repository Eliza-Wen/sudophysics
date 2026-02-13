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

const LEVEL_COUNT = 12
const MIN_GRID_SIZE = 3
const MAX_GRID_SIZE = 14

const SUCCESS_MESSAGES = [
  "You're so smart!",
  "You're the smartest person in the world!",
  "You're amazing!",
  "Today is your lucky day!",
]

const FAIL_MESSAGES = [
  'Try one more time, you can do it!',
  "You're so close!",
  "Don't give up!",
]

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
  const [score, setScore] = useState(0)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [isLevelClaimed, setIsLevelClaimed] = useState(false)
  const [seed, setSeed] = useState(1)
  const [bannerMessage, setBannerMessage] = useState('')
  const [scoreDelta, setScoreDelta] = useState<number | null>(null)
  const [scoreFlash, setScoreFlash] = useState(false)
  const [barrageMessages, setBarrageMessages] = useState<BarrageMessage[]>([])
  const [levelOutcome, setLevelOutcome] = useState<OutcomeState>('NONE')
  const barrageIdRef = useRef(1)
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
  const powerupCost = Math.max(1, Math.ceil(score * 0.5))

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
    const updateLayout = () => {
      const screenWidth = window.innerWidth
      const screenHeight = window.innerHeight
      const width = Math.min(980, Math.max(300, screenWidth - (screenWidth < 520 ? 12 : 24)))

      const hudHeight = screenWidth < 520 ? 180 : screenWidth < 640 ? 150 : 120
      const verticalPadding = 24
      const availableHeight = Math.max(420, screenHeight - hudHeight - verticalPadding)

      const height = Math.min(Math.round(width * 1.15), availableHeight)
      const gridSizePx = Math.min(
        Math.round(width * (screenWidth < 520 ? 0.8 : 0.72)),
        Math.round(height * 0.6),
      )
      const gridX = Math.round((width - gridSizePx) / 2)
      const gridY = Math.max(10, Math.round(height * 0.04))
      const gutter = Math.max(12, Math.round(height * 0.05))
      const poolY = gridY + gridSizePx + gutter
      const poolHeight = Math.max(screenWidth < 520 ? 90 : 110, height - poolY - gutter)
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
  }, [])

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

  const playBarrage = (messages: string[], count: number) => {
    let sent = 0
    const burst = () => {
      const text = messages[Math.floor(Math.random() * messages.length)]
      pushBarrage(text)
      sent += 1
    }
    burst()
    const interval = window.setInterval(() => {
      burst()
      if (sent >= count) window.clearInterval(interval)
    }, 520)
    return () => window.clearInterval(interval)
  }

  useEffect(() => {
    if (modalState === 'SUCCESS') {
      const burst = () => {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } })
        confetti({ particleCount: 80, spread: 120, origin: { x: 0.2, y: 0.4 } })
        confetti({ particleCount: 80, spread: 120, origin: { x: 0.8, y: 0.4 } })
      }
      burst()
      setBannerMessage(SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)])
      const stopBarrage = playBarrage(SUCCESS_MESSAGES, 10)

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

      return () => {
        stopBarrage()
      }
    }

    if (modalState === 'FAIL') {
      setBannerMessage(FAIL_MESSAGES[Math.floor(Math.random() * FAIL_MESSAGES.length)])
      const stopBarrage = playBarrage(FAIL_MESSAGES, 8)
      return () => stopBarrage()
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

    const { Engine, Render, Runner, World, Bodies, Mouse, MouseConstraint, Events, Composite, Body } = Matter

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
    const mouse = Mouse.create(render.canvas)
    const pixelRatio = render.options.pixelRatio ?? window.devicePixelRatio ?? 1
    Mouse.setScale(mouse, {
      x: 1 / pixelRatio,
      y: 1 / pixelRatio,
    })
    const updateMouseOffset = () => {
      const rect = render.canvas.getBoundingClientRect()
      Mouse.setOffset(mouse, { x: rect.left, y: rect.top })
    }
    updateMouseOffset()
    window.addEventListener('resize', updateMouseOffset)

    const mouseAny = mouse as unknown as {
      mousedown?: (event: Event) => void
      mousemove?: (event: Event) => void
      mouseup?: (event: Event) => void
      touchstart?: (event: TouchEvent) => void
      touchmove?: (event: TouchEvent) => void
      touchend?: (event: TouchEvent) => void
    }

    const handleTouchStart = (event: TouchEvent) => {
      event.preventDefault()
      mouseAny.touchstart?.(event)
      mouseAny.mousedown?.(event)
    }

    const handleTouchMove = (event: TouchEvent) => {
      event.preventDefault()
      mouseAny.touchmove?.(event)
      mouseAny.mousemove?.(event)
    }

    const handleTouchEnd = (event: TouchEvent) => {
      event.preventDefault()
      mouseAny.touchend?.(event)
      mouseAny.mouseup?.(event)
    }

    render.canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
    render.canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
    render.canvas.addEventListener('touchend', handleTouchEnd, { passive: false })
    const mouseConstraint = MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: {
        stiffness: 0.2,
        render: { visible: false },
      },
    })
    Composite.add(engine.world, mouseConstraint)
    render.mouse = mouse

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
        pushBarrage(SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)])
        setModalState('SUCCESS')
        setLevelOutcome('SUCCESS')
      } else {
        pushBarrage(FAIL_MESSAGES[Math.floor(Math.random() * FAIL_MESSAGES.length)])
        setModalState('FAIL')
        setLevelOutcome('FAIL')
      }
    }

    type DragEvent = Matter.IEvent<Matter.MouseConstraint> & { body?: Matter.Body }

    const handleRelease = (event: DragEvent) => {
      const body = event.body
      if (!body) return

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

      if (!nearest || nearestDistance > snapThreshold) return

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

    const handleStartDrag = (event: DragEvent) => {
      const body = event.body
      if (!body) return
      const slotIndex = bodyToSlotRef.current.get(body.id)
      if (slotIndex === undefined) return
      Body.setStatic(body, false)
      clearSlot(slotIndex)
      body.render.strokeStyle = '#334155'
    }

    Events.on(mouseConstraint, 'enddrag', handleRelease)
    Events.on(mouseConstraint, 'startdrag', handleStartDrag)

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
      Events.off(mouseConstraint, 'enddrag', handleRelease)
      Events.off(mouseConstraint, 'startdrag', handleStartDrag)
      Events.off(engine, 'beforeUpdate', lockSnapped)
      window.removeEventListener('resize', updateMouseOffset)
      render.canvas.removeEventListener('touchstart', handleTouchStart)
      render.canvas.removeEventListener('touchmove', handleTouchMove)
      render.canvas.removeEventListener('touchend', handleTouchEnd)
      Render.stop(render)
      Runner.stop(runner)
      World.clear(engine.world, false)
      Matter.Engine.clear(engine)
      render.canvas.remove()
      render.textures = {}
    }
  }, [gameState, layout, slotInfo, gridSize])

  const startGame = () => {
    const now = Date.now()
    setSeed(now)
    setStartTime(now)
    setScore(0)
    setCurrentLevel(1)
    setIsLevelClaimed(false)
    setModalState('NONE')
    setLevelOutcome('NONE')
    setGameState('PLAYING')
  }

  const exitToMenu = () => {
    setModalState('NONE')
    setLevelOutcome('NONE')
    setGameState('MENU')
  }

  const goNextLevel = () => {
    if (currentLevel >= LEVEL_COUNT) {
      setGameState('GAME_OVER')
      return
    }
    setCurrentLevel((prev) => Math.min(LEVEL_COUNT, prev + 1))
    setIsLevelClaimed(false)
    setModalState('NONE')
    setScoreDelta(null)
    setScoreFlash(false)
    setLevelOutcome('NONE')
    setGameState('PLAYING')
  }

  const restartGame = () => {
    setScore(0)
    setCurrentLevel(1)
    setIsLevelClaimed(false)
    const now = Date.now()
    setStartTime(now)
    setSeed(now)
    setModalState('NONE')
    setLevelOutcome('NONE')
    setGameState('PLAYING')
  }

  const retryLevel = () => {
    const now = Date.now()
    setSeed(now)
    setStartTime(now)
    setIsLevelClaimed(false)
    setModalState('NONE')
    setLevelOutcome('NONE')
    setScoreDelta(null)
    setScoreFlash(false)
    setGameState('PLAYING')
  }

  const applyPowerup = (type: 'AUTO_FILL' | 'SHUFFLE' | 'CALM') => {
    if (score < powerupCost || !engineRef.current) return
    setScore((prev) => Math.max(0, prev - powerupCost))

    if (type === 'AUTO_FILL') {
      const targetSlot = slotCentersRef.current.find((slot) => !slotToBodyRef.current.has(slot.index))
      if (!targetSlot) return
      const bodies = Matter.Composite.allBodies(engineRef.current.world)
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
  }

  const elapsed = useMemo(() => {
    if (!startTime) return { minutes: 0, seconds: 0 }
    const diff = Date.now() - startTime
    const minutes = Math.floor(diff / 60000)
    const seconds = Math.floor((diff % 60000) / 1000)
    return { minutes, seconds }
  }, [startTime, gameState])

  const showGame = gameState === 'PLAYING' || modalState !== 'NONE' || levelOutcome !== 'NONE'
  const isBlurred = modalState !== 'NONE' || levelOutcome !== 'NONE'
  const outcomeState: OutcomeState =
    levelOutcome !== 'NONE'
      ? levelOutcome
      : modalState === 'SUCCESS' || modalState === 'FAIL'
        ? modalState
        : 'NONE'
  const cellFontSize = Math.max(14, Math.floor((layout.gridSize / gridSize) * 0.55))

  return (
    <div className="nature-bg text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
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
          <div className="panel flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center">
            <p className="text-xs uppercase tracking-[0.4em] text-emerald-700/80">Welcome</p>
            <h1 className="text-4xl font-semibold tracking-[0.3em] text-emerald-900">SUDO-PHYSICS</h1>
            <div className="text-sm uppercase tracking-[0.35em] text-emerald-700/70">Total Score</div>
            <div className="text-3xl font-semibold text-amber-700">{score}</div>
            <button type="button" onClick={startGame} className="btn-primary">
              Start Game
            </button>
          </div>
        )}

        {showGame && (
          <>
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
              className={`panel game-panel relative mx-auto ${isBlurred ? 'blur-[1.5px]' : ''}`}
              style={{ width: layout.width || '100%' }}
            >
              <div className="relative" style={{ height: layout.height || 640 }}>
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
                            {isEmpty ? (
                              <span className="cell-dot" />
                            ) : (
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
                    className="absolute pool"
                    style={{
                      left: layout.poolX,
                      top: layout.poolY,
                      width: layout.poolWidth,
                      height: layout.poolHeight,
                    }}
                  >
                    <div className="pool-label">Ball Pool</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {gameState === 'GAME_OVER' && (
          <div className="panel mt-6 flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
            <h2 className="text-3xl font-semibold text-emerald-900">Congratulations!</h2>
            <p className="text-lg text-emerald-900/80">
              You spent {elapsed.minutes} minutes and {elapsed.seconds} seconds in the garden of logic.
            </p>
            <div className="text-2xl font-semibold text-amber-700">Final Score: {score}</div>
            <button type="button" onClick={restartGame} className="btn-primary">
              Play Again
            </button>
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
                You earned +{levelReward} points. Fireworks, confetti, and good vibes!
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
                <button
                  type="button"
                  onClick={() => {
                    setLevelOutcome('NONE')
                    setModalState('POWERUPS')
                  }}
                  className="btn-secondary"
                >
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
              <p className="mt-2 text-sm text-emerald-900/70">
                Each power-up costs 50% of your current points ({powerupCost} pts).
              </p>
              <div className="mt-4 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => applyPowerup('AUTO_FILL')}
                  disabled={score < powerupCost}
                  className="btn-secondary"
                >
                  Auto-fill one number
                </button>
                <button
                  type="button"
                  onClick={() => applyPowerup('SHUFFLE')}
                  disabled={score < powerupCost}
                  className="btn-secondary"
                >
                  Shuffle loose balls
                </button>
                <button
                  type="button"
                  onClick={() => applyPowerup('CALM')}
                  disabled={score < powerupCost}
                  className="btn-secondary"
                >
                  Calm breeze (slow gravity)
                </button>
                <button type="button" onClick={() => setModalState('NONE')} className="btn-tertiary">
                  Close
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