import { AppStateProvider } from './state'
import Sidebar from './components/Sidebar'
import PlanBar from './components/PlanBar'
import MapView from './components/MapView'
import AreaCompare from './components/AreaCompare'
import AreaDetail from './components/AreaDetail'
import Inspector from './components/Inspector'
import { useAppState } from './state'

function Shell() {
  const { focus, compareTarget, detailAreaId } = useAppState()
  const report = Boolean(compareTarget || detailAreaId)
  return (
    <div className="app">
      <Sidebar />
      <main className="stage">
        <PlanBar />
        <div className={report ? 'stage-map is-report' : 'stage-map'}>
          <MapView />
          {detailAreaId ? <AreaDetail /> : null}
          {compareTarget ? <AreaCompare /> : null}
        </div>
      </main>
      {focus ? <Inspector /> : null}
    </div>
  )
}

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  )
}
