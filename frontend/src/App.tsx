import { useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { PanelSize } from 'react-resizable-panels';
import Header from './components/Header/Header';
import FlightMap from './components/Map/FlightMap';
import FIRLayer from './components/Map/FIRLayer';
import Legend from './components/Map/Legend';
import ADSBPanel from './components/ADSBPanel/ADSBPanel';
import InfoPanel from './components/InfoPanel/InfoPanel';
import StatusBar from './components/StatusBar/StatusBar';
import FIRSelectionModal from './components/FIRSelectionModal/FIRSelectionModal';
import VisibleFlightsDriver from './components/VisibleFlightsDriver';
import { useWebSocket } from './hooks/useWebSocket';
import { useFIRStore } from './stores/firStore';
import { useUIStore } from './stores/uiStore';

export default function App() {
  useWebSocket();
  const firSetupComplete = useFIRStore((s) => s.firSetupComplete);
  const { leftCollapsed, infoPanelOpen, setLeftCollapsed, setLeftSize, setRightSize, leftSize, rightSize } = useUIStore();

  const showRight = infoPanelOpen;

  const onLeftResize = useCallback((panelSize: PanelSize) => {
    if (panelSize.asPercentage > 2) setLeftSize(panelSize.asPercentage);
  }, [setLeftSize]);

  const onRightResize = useCallback((panelSize: PanelSize) => {
    if (panelSize.asPercentage > 2) setRightSize(panelSize.asPercentage);
  }, [setRightSize]);

  return (
    <>
      <Header
        leftCollapsed={leftCollapsed}
        onToggleLeft={() => setLeftCollapsed(!leftCollapsed)}
      />
      <VisibleFlightsDriver />
      <div className="app-shell">
        <Group orientation="horizontal">
          {!leftCollapsed && (
            <>
              <Panel
                id="left-panel"
                defaultSize={leftSize}
                minSize={14}
                maxSize={35}
                onResize={onLeftResize}
              >
                <ADSBPanel />
              </Panel>
              <Separator className="resize-handle resize-handle--vertical" />
            </>
          )}
          <Panel id="center-panel" minSize={30}>
            <FlightMap />
            <FIRLayer />
            <Legend />
          </Panel>
          {showRight && (
            <>
              <Separator className="resize-handle resize-handle--vertical" />
              <Panel
                id="right-panel"
                defaultSize={rightSize}
                minSize={16}
                maxSize={35}
                onResize={onRightResize}
              >
                <InfoPanel />
              </Panel>
            </>
          )}
        </Group>
      </div>
      <StatusBar />
      {!firSetupComplete && <FIRSelectionModal />}
    </>
  );
}
