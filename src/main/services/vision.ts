import * as tf from '@tensorflow/tfjs'
import * as mobilenet from '@tensorflow-models/mobilenet'
import sharp from 'sharp'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { tmpdir } from 'os'
import { join, extname } from 'path'
import { unlink } from 'fs/promises'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)

const CATEGORY_MAP: [string[], string][] = [
  [['pizza', 'hamburger', 'hotdog', 'sandwich', 'burrito', 'soup', 'salad', 'sushi', 'bread', 'cake', 'cookie', 'coffee', 'espresso', 'wine', 'beer', 'cocktail', 'restaurant', 'dining'], 'Food & Dining'],
  [['dog', 'cat', 'bird', 'fish', 'horse', 'elephant', 'bear', 'zebra', 'giraffe', 'sheep', 'cow', 'rabbit', 'hamster', 'parrot', 'aquarium'], 'Animals & Pets'],
  [['mountain', 'seashore', 'beach', 'forest', 'valley', 'cliff', 'lakeside', 'waterfall', 'geyser', 'coral reef', 'alp', 'volcano', 'desert', 'tundra', 'rainforest', 'canyon', 'prairie', 'sky', 'sunset', 'sunrise'], 'Landscapes & Nature'],
  [['castle', 'church', 'monastery', 'mosque', 'palace', 'museum', 'library', 'bridge', 'tower', 'skyscraper', 'architecture', 'street', 'traffic', 'parking'], 'Architecture & Cities'],
  [['aircraft', 'airplane', 'airport', 'car', 'train', 'boat', 'ship', 'submarine', 'bicycle', 'motorcycle', 'bus', 'truck', 'canoe', 'kayak', 'locomotive'], 'Travel & Transport'],
  [['tennis', 'basketball', 'football', 'soccer', 'baseball', 'golf', 'swimming', 'cycling', 'running', 'skiing', 'snowboard', 'surfboard', 'gym', 'dumbbell', 'stadium'], 'Sports & Activity'],
  [['monitor', 'keyboard', 'mouse', 'laptop', 'phone', 'remote control', 'television', 'camera', 'tripod'], 'Documents & Screenshots'],
]

let model: mobilenet.MobileNet | null = null

async function getModel(): Promise<mobilenet.MobileNet> {
  if (!model) {
    await tf.setBackend('cpu')
    await tf.ready()
    model = await mobilenet.load({ version: 2, alpha: 1.0 })
  }
  return model
}

async function toJpegPath(filePath: string): Promise<{ path: string; temp: boolean }> {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.heic' || ext === '.heif') {
    const tmpPath = join(tmpdir(), `snapsortie-${randomUUID()}.jpg`)
    await execFileAsync('sips', ['-s', 'format', 'jpeg', filePath, '--out', tmpPath])
    return { path: tmpPath, temp: true }
  }
  return { path: filePath, temp: false }
}

export async function classifyPhoto(filePath: string): Promise<string> {
  const net = await getModel()

  const { path: jpegPath, temp } = await toJpegPath(filePath)

  const { data } = await sharp(jpegPath)
    .resize(224, 224)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (temp) await unlink(jpegPath).catch(() => {})

  const tensor = tf.tensor3d(new Uint8Array(data), [224, 224, 3])
  const predictions = await net.classify(tensor, 10)
  tensor.dispose()

  const labels = predictions
    .filter(p => p.probability > 0.1)
    .map(p => p.className.toLowerCase())

  for (const [keywords, category] of CATEGORY_MAP) {
    if (labels.some(label => keywords.some(kw => label.includes(kw)))) {
      return category
    }
  }

  return 'Other'
}
