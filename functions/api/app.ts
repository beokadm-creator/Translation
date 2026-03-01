import express, { type Request, type Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import audioRoutes from './routes/audio.js'

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

/** API Routes */
app.use('/api/audio', audioRoutes)

/** health */
app.use('/api/health', (req: Request, res: Response): void => {
  res.status(200).json({ success: true, message: 'ok' })
})

/** error handler middleware */
app.use((error: Error, _req: Request, res: Response) => {
  res.status(500).json({ success: false, error: error.message })
})

/** 404 handler */
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'API not found' })
})

export default app
