import React, { useEffect, useState } from 'react';
import LoadingButton from '@mui/lab/LoadingButton';

function Test({ id }) {
  const [testJson, setTestJson] = useState({});

  useEffect(() => {
    fetch(`https://raw.githubusercontent.com/TomHarte/ProcessorTests/main/6502/v1/${id.toString()}.json`)
      .then((res) => res.json())
      .then((data) => {
        setTestJson(data);
      })
      .catch((err) => {
        console.log(err.message);
      });
  }, []);

  if (testJson !== {}) {
    return (
      <h3>{testJson.name}</h3>
    );
  }

  return (
    <LoadingButton loading variant="outlined" />
  );
}

export default Test;
