import { memo } from 'react'
import type { RenderComponentProps } from 'masonic'
import { MediaCell } from './MediaCell'
import { PhotoCell } from './PhotoCell'
import type { MediaFile } from '../types'

interface GalleryCellProps extends RenderComponentProps<MediaFile> {
  slotKey: string
  useFixedHeight: boolean
  aspectRatio: number
}

export const GalleryCell = memo(function GalleryCell(props: GalleryCellProps) {
  if (props.data.kind === 'image') {
    return <PhotoCell {...props} />
  }
  return <MediaCell {...props} />
})
