import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ConfirmModal } from './shared/ConfirmModal'
import { checkForAppUpdate, type AvailableUpdate } from '../services/updater'
import { logger } from '../lib/logger'

/**
 * One launch-time Update / Later dialog when a newer signed build is published.
 * Mount once under the app shell; no toast storm (#92).
 */
export function UpdaterPrompt() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const available = await checkForAppUpdate()
      if (!cancelled && available) setUpdate(available)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const handleLater = () => {
    if (installing) return
    const current = update
    setUpdate(null)
    void current?.dismiss()
  }

  const handleUpdate = async () => {
    if (!update || installing) return
    setInstalling(true)
    try {
      await update.install()
    } catch (err) {
      logger.error('Update install failed', err)
      toast.error('Update failed. The installed version was left unchanged.')
      setInstalling(false)
      setUpdate(null)
      void update.dismiss()
    }
  }

  if (!update) return null

  const notes = update.notes
  const description = notes
    ? (
        <>
          <p>Version {update.version} is available.</p>
          <p className="mt-gs-3 whitespace-pre-wrap">{notes}</p>
        </>
      )
    : `Version ${update.version} is available.`

  return (
    <ConfirmModal
      isOpen
      onClose={handleLater}
      title="Update available"
      description={description}
      cancelLabel="Later"
      icon={null}
      busy={installing}
      confirmAction={{
        label: installing ? 'Updating…' : 'Update',
        style: 'primary',
        onClick: () => {
          void handleUpdate()
        },
      }}
    />
  )
}
