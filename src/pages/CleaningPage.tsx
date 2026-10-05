import PageShell from '../components/PageShell'
import CleaningWorkspace from '../features/cleaning/CleaningWorkspace'

export default function CleaningPage() {
  return (
    <PageShell path="/cleaning">
      <CleaningWorkspace />
    </PageShell>
  )
}
