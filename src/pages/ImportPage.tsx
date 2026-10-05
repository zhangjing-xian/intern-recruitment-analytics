import PageShell from '../components/PageShell'
import ImportWorkspace from '../features/import/ImportWorkspace'

export default function ImportPage() {
  return (
    <PageShell path="/import">
      <ImportWorkspace />
    </PageShell>
  )
}
