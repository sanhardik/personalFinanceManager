import pytest

pytestmark = pytest.mark.anyio


async def test_auth_status_no_user(client_no_auth):
    resp = await client_no_auth.get("/auth/status")
    assert resp.status_code == 200
    assert resp.json() == {"is_configured": False}


async def test_setup_valid_credentials(client_no_auth):
    resp = await client_no_auth.post("/auth/setup", json={"username": "admin", "password": "SecurePass1!"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


async def test_setup_twice_returns_409(client_no_auth):
    await client_no_auth.post("/auth/setup", json={"username": "admin", "password": "SecurePass1!"})
    resp = await client_no_auth.post("/auth/setup", json={"username": "admin2", "password": "SecurePass1!"})
    assert resp.status_code == 409


async def test_setup_password_too_short(client_no_auth):
    resp = await client_no_auth.post("/auth/setup", json={"username": "admin", "password": "Short1!"})
    assert resp.status_code == 422


async def test_setup_password_no_uppercase(client_no_auth):
    resp = await client_no_auth.post("/auth/setup", json={"username": "admin", "password": "nouppercase1!"})
    assert resp.status_code == 422


async def test_setup_password_no_digit(client_no_auth):
    resp = await client_no_auth.post("/auth/setup", json={"username": "admin", "password": "NoDigitHere!!"})
    assert resp.status_code == 422


async def test_setup_password_no_special_char(client_no_auth):
    resp = await client_no_auth.post("/auth/setup", json={"username": "admin", "password": "NoSpecialChar1"})
    assert resp.status_code == 422


async def test_login_valid_credentials(client_no_auth):
    await client_no_auth.post("/auth/setup", json={"username": "admin", "password": "SecurePass1!"})
    resp = await client_no_auth.post("/auth/login", json={"username": "admin", "password": "SecurePass1!"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


async def test_login_wrong_password(client_no_auth):
    await client_no_auth.post("/auth/setup", json={"username": "admin", "password": "SecurePass1!"})
    resp = await client_no_auth.post("/auth/login", json={"username": "admin", "password": "WrongPassword1!"})
    assert resp.status_code == 401


async def test_protected_route_no_token(client_no_auth):
    resp = await client_no_auth.get("/accounts")
    assert resp.status_code == 403


async def test_protected_route_with_valid_token(client_no_auth):
    setup = await client_no_auth.post("/auth/setup", json={"username": "admin", "password": "SecurePass1!"})
    token = setup.json()["access_token"]
    resp = await client_no_auth.get("/accounts", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


async def test_auth_status_after_setup(client_no_auth):
    await client_no_auth.post("/auth/setup", json={"username": "admin", "password": "SecurePass1!"})
    resp = await client_no_auth.get("/auth/status")
    assert resp.status_code == 200
    assert resp.json() == {"is_configured": True}
