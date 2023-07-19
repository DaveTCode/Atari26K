import React from 'react';
import Grid from '@mui/material/Unstable_Grid2';
import Container from '@mui/material/Container';

const App = () => {
  return (
    <Container>
      <Grid container spacing={2}>
        <Grid xs={8}>
          xs=8
        </Grid>
        <Grid xs={4}>
          xs=4
        </Grid>
        <Grid xs={4}>
          xs=4
        </Grid>
        <Grid xs={8}>
          xs=8
        </Grid>
      </Grid>
    </Container>
  );
}

export default App;