import React, { createContext, useState, useEffect } from 'react';
import { getROM } from "sm64-binds-frontend";

const BlockchainContext = createContext();

const BlockchainProvider = ({ children }) => {
	const [hasRom, setHasRom] = useState(false);

	return (
		<BlockchainContext.Provider value={{ hasRom, setHasRom }}>
		{children}
		</BlockchainContext.Provider>
	);
};

export { BlockchainContext, BlockchainProvider };
