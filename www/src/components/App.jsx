import React, { useState } from 'react';
import Grid from '@mui/material/Unstable_Grid2';
import Container from '@mui/material/Container';
import Emulator from './Emulator';

function App() {
  const [romContents, setRomContents] = useState({});
  const [romLoaded, setRomLoaded] = useState(false);

  const handleUpload = ({ target }) => {
    const fileReader = new FileReader();

    fileReader.readAsArrayBuffer(target.files[0]);
    fileReader.onload = () => {
      setRomContents(new Uint8Array(fileReader.result));
      setRomLoaded(true);
    };
  };

  if (romLoaded) {
    return <Emulator rom={romContents} />;
  }

  return (
    <Container>
      <Grid container spacing={2}>
        <Grid xs={4} />
        <Grid xs={4}>
          <input
            accept="*"
            id="rom-upload"
            onChange={handleUpload}
            type="file"
          />
        </Grid>
        <Grid xs={4} />
      </Grid>
    </Container>
  );
}

export default App;
