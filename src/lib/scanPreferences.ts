const IMAGES_ONLY_KEY = 'mpfour:imagesOnly'

function readImagesOnly(): boolean {
  try {
    return localStorage.getItem(IMAGES_ONLY_KEY) === '1'
  } catch {
    return false
  }
}

let imagesOnly = readImagesOnly()

/** When true, scans ignore every video extension and only collect images. */
export function isImagesOnly(): boolean {
  return imagesOnly
}

export function setImagesOnly(value: boolean): void {
  imagesOnly = value
  try {
    localStorage.setItem(IMAGES_ONLY_KEY, value ? '1' : '0')
  } catch {
    // storage unavailable (private mode); setting lasts for this page only
  }
}
