import { Show } from '@clerk/nextjs'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { CustomConsentForm } from './custom-consent-form'

export const metadata: Metadata = {
  referrer: 'strict-origin-when-cross-origin',
}

export default function OAuthConsentPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: '#03050b' }}
    >
      <Show when="signed-in">
        <Suspense fallback={<p>Loading consent request...</p>}>
          <CustomConsentForm />
        </Suspense>
      </Show>
    </div>
  )
}
