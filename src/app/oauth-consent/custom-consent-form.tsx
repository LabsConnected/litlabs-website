'use client'

import { useClerk, useOAuthConsent, useUser } from '@clerk/nextjs'
import { useSearchParams } from 'next/navigation'

export function CustomConsentForm() {
  const clerk = useClerk()
  const { user } = useUser()
  const searchParams = useSearchParams()

  const clientId = searchParams.get('client_id') ?? ''
  const redirectUri = searchParams.get('redirect_uri') ?? ''
  const scope = searchParams.get('scope') ?? undefined

  const { data, isLoading, error } = useOAuthConsent({
    oauthClientId: clientId,
    scope,
    redirectUri,
  })

  if (!clientId || !redirectUri) {
    return <p>Missing OAuth consent parameters.</p>
  }

  if (isLoading) {
    return <p>Loading consent request...</p>
  }

  if (error || !data) {
    return <p>Unable to load consent request.</p>
  }

  const actionUrl =
    clerk.oauthApplication.buildConsentActionUrl({ clientId })

  return (
    <form
      method="POST"
      action={actionUrl}
      className="w-full max-w-lg rounded-xl border border-[#29345e] bg-[#090d1b] p-6 text-[#eef4ff]"
    >
      <h1 className="mb-2 text-2xl font-semibold">
        {data.oauthApplicationName} wants access
      </h1>

      {data.oauthApplicationLogoUrl && (
        <img
          src={data.oauthApplicationLogoUrl}
          alt={`${data.oauthApplicationName} logo`}
          className="mb-4 h-12 w-12 rounded-lg"
        />
      )}

      {data.oauthApplicationUrl && (
        <p className="mb-2 text-sm text-[#9ba7c7]">
          Application: {data.oauthApplicationUrl}
        </p>
      )}

      <p className="mb-2 text-xs text-[#9ba7c7]">
        Client ID: <code>{data.clientId}</code>
      </p>

      <p className="mb-4 text-sm">
        Resource service: LiTTree LabStudios
      </p>

      <p className="mb-4 text-sm text-[#9ba7c7]">
        Signed in as{' '}
        {user?.primaryEmailAddress?.emailAddress ??
          user?.username ??
          user?.id}
      </p>

      <p className="mb-2 text-sm">
        Redirect destination:{' '}
        <strong>
          {data.redirectDomain || new URL(redirectUri).hostname}
        </strong>
      </p>

      <details className="mb-4 text-xs text-[#9ba7c7]">
        <summary>View full redirect URL</summary>
        <code className="break-all">{redirectUri}</code>
      </details>

      <ul className="mb-6 list-disc space-y-2 pl-5 text-sm">
        {data.scopes.map((item) => (
          <li key={item.scope}>
            {item.description || item.scope}
          </li>
        ))}
      </ul>

      {Array.from(searchParams.entries())
        .filter(
          ([key]) =>
            key !== 'consented' && key !== 'organization_id',
        )
        .map(([key, value], index) => (
          <input
            key={`${key}:${index}`}
            type="hidden"
            name={key}
            value={value}
          />
        ))}

      <div className="flex gap-3">
        <button
          type="submit"
          name="consented"
          value="false"
          className="flex-1 rounded-lg border border-white/20 px-4 py-3"
        >
          Deny
        </button>

        <button
          type="submit"
          name="consented"
          value="true"
          className="flex-1 rounded-lg bg-[#a970ff] px-4 py-3 font-semibold text-white"
        >
          Allow
        </button>
      </div>
    </form>
  )
}
