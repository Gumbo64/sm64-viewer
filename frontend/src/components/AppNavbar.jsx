import React from 'react';
import { Navbar, Nav } from 'react-bootstrap';
import { Link } from 'react-router';

const AppNavbar = () => {
	return (
		<Navbar bg="dark" variant="dark" expand="lg">
			<Navbar.Brand as={Link} to="/sm64-viewer">Mario 64 Viewer</Navbar.Brand>
		</Navbar>
	);
};

export default AppNavbar;
