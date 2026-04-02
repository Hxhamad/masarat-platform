import Header from './components/Header/Header';
import FlightMap from './components/Map/FlightMap';
import FIRLayer from './components/Map/FIRLayer';
import Legend from './components/Map/Legend';
import ADSBPanel from './components/ADSBPanel/ADSBPanel';
import InfoPanel from './components/InfoPanel/InfoPanel';
import StatusBar from './components/StatusBar/StatusBar';
import { useWebSocket } from './hooks/useWebSocket';

export default function App() {
  useWebSocket();

  return (
    <>
      <Header />
      <FlightMap />
      <FIRLayer />
      <Legend />
      <ADSBPanel />
      <InfoPanel />
      <StatusBar />
    </>
  );
}
