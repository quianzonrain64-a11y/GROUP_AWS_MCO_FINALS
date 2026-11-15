// CampusVote logic. Talks to the contract through MetaMask and paints the
// six screens.

// The Remix address goes here, or paste it into the box on the page instead.
const contractAddress = "PASTE_DEPLOYED_CONTRACT_ADDRESS_HERE";

const contractABI = [
  // admin writes
  "function addCandidate(string name, string position)",
  "function authorizeVoter(address voter)",
  "function startElection()",
  "function endElection()",

  // voter writes
  "function requestVoterRegistration(string name, string studentId)",
  "function vote(uint256 candidateId)",

  // reads used by the page
  "function getCandidate(uint256 candidateId) view returns (uint256 id, string name, string position, uint256 voteCount, bool exists)",
  "function getCandidateCount() view returns (uint256)",
  "function getTotalVotes() view returns (uint256)",
  "function getElectionStatus() view returns (bool)",
  "function getRegistrationStatus(address voter) view returns (bool requested, bool authorized, bool voted, string name, string studentId)",
  "function getRegistrationQueueLength() view returns (uint256)",
  "function registrationQueue(uint256 index) view returns (address)",
  "function authorizedVoterCount() view returns (uint256)",
  "function owner() view returns (address)",
];

// Classroom shortcut. A real election would check this on a server.
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "campusvote2026";

// Where the setup box remembers the address.
const STORAGE_KEY = "campusvote.contract.address";

function looksLikeAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || ""));
}

// The address set at the top wins, otherwise the one saved by the setup box.
function pickContractAddress() {
  if (looksLikeAddress(contractAddress)) return contractAddress;

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (looksLikeAddress(saved)) return saved;
  } catch (error) {
    // Some browsers block storage for local files. The box just asks again.
  }

  return "";
}

let activeContractAddress = pickContractAddress();

// Read only connection, then the wallet that signs, then the contract itself.
let provider = null;
let signer = null;
let contract = null;

let userAccount = null;
let contractOwner = null;
let adminLoggedIn = false;

// Cached copy of this wallet's standing, so the vote button can explain itself.
let voterStatus = { requested: false, authorized: false, voted: false, name: "", studentId: "" };

// Every element the script touches, grabbed once.
const connectButton = document.getElementById("connectButton");
const refreshButton = document.getElementById("refreshButton");
const walletStatus = document.getElementById("walletStatus");
const networkBadge = document.getElementById("networkBadge");
const electionStatus = document.getElementById("electionStatus");
const totalVotes = document.getElementById("totalVotes");
const candidateList = document.getElementById("candidateList");
const candidatesMeta = document.getElementById("candidatesMeta");

// registration screen
const registerForm = document.getElementById("registerForm");
const registerName = document.getElementById("registerName");
const registerStudentId = document.getElementById("registerStudentId");
const registrationMessage = document.getElementById("registrationMessage");
const regWallet = document.getElementById("regWallet");
const regName = document.getElementById("regName");
const regStudentId = document.getElementById("regStudentId");
const regState = document.getElementById("regState");
const goToVoteButton = document.getElementById("goToVoteButton");

// ballot screen
const ballotList = document.getElementById("ballotList");
const voteNotice = document.getElementById("voteNotice");
const submitVoteButton = document.getElementById("submitVoteButton");
const voteMessage = document.getElementById("voteMessage");

// results screen
const resultsLocked = document.getElementById("resultsLocked");
const resultsPanel = document.getElementById("resultsPanel");
const resultsMeta = document.getElementById("resultsMeta");
const winnerName = document.getElementById("winnerName");
const winnerVotes = document.getElementById("winnerVotes");
const resultsRows = document.getElementById("resultsRows");

// admin login
const adminLoginForm = document.getElementById("adminLoginForm");
const adminUsername = document.getElementById("adminUsername");
const adminPassword = document.getElementById("adminPassword");
const adminLoginMessage = document.getElementById("adminLoginMessage");

// admin panel
const addCandidateForm = document.getElementById("addCandidateForm");
const candidateName = document.getElementById("candidateName");
const candidatePosition = document.getElementById("candidatePosition");
const authorizeForm = document.getElementById("authorizeForm");
const voterAddress = document.getElementById("voterAddress");
const startElectionButton = document.getElementById("startElectionButton");
const endElectionButton = document.getElementById("endElectionButton");
const pendingList = document.getElementById("pendingList");
const adminWallet = document.getElementById("adminWallet");
const adminElectionStatus = document.getElementById("adminElectionStatus");
const adminMessage = document.getElementById("adminMessage");
const adminLogoutButton = document.getElementById("adminLogoutButton");

// footer and toast
const contractAddressLabel = document.getElementById("contractAddressLabel");
const networkLabel = document.getElementById("networkLabel");
const toast = document.getElementById("toast");

// setup box
const setupPanel = document.getElementById("setupPanel");
const setupForm = document.getElementById("setupForm");
const setupAddress = document.getElementById("setupAddress");
const setupMessage = document.getElementById("setupMessage");
const changeAddressButton = document.getElementById("changeAddressButton");

// Handlers, attached once at startup.
connectButton.addEventListener("click", connectWallet);

refreshButton.addEventListener("click", function () {
  refreshEverything();
  showToast("Data refreshed.");
});

// Tabs also keep the admin panel behind the login form.
document.querySelectorAll(".tab").forEach(function (tabButton) {
  tabButton.addEventListener("click", function () {
    const targetView = tabButton.getAttribute("data-view");

    if (targetView === "view-admin" && !adminLoggedIn) {
      showView("view-admin-login");
      setMessage(adminLoginMessage, "Log in first to reach the admin panel.", "error");
      return;
    }

    showView(targetView);
  });
});

registerForm.addEventListener("submit", function (event) {
  event.preventDefault();
  submitRegistration();
});

goToVoteButton.addEventListener("click", function () {
  showView("view-vote");
});

submitVoteButton.addEventListener("click", submitVote);

adminLoginForm.addEventListener("submit", function (event) {
  event.preventDefault();
  adminLogin();
});

addCandidateForm.addEventListener("submit", function (event) {
  event.preventDefault();
  addCandidate();
});

authorizeForm.addEventListener("submit", function (event) {
  event.preventDefault();
  authorizeVoter();
});

startElectionButton.addEventListener("click", startElection);
endElectionButton.addEventListener("click", endElection);

adminLogoutButton.addEventListener("click", function () {
  adminLoggedIn = false;
  showView("view-admin-login");
  setMessage(adminLoginMessage, "Logged out of the admin panel.", "ok");
});

contractAddressLabel.textContent = activeContractAddress || "not set yet";

if (!activeContractAddress) {
  setupPanel.hidden = false;
}

setupForm.addEventListener("submit", function (event) {
  event.preventDefault();
  saveContractAddress();
});

changeAddressButton.addEventListener("click", function () {
  setupAddress.value = activeContractAddress;
  setupPanel.hidden = false;
  setupAddress.focus();
  setMessage(setupMessage, "", "");
});

// The MetaMask handshake.
async function connectWallet() {
  if (typeof window.ethereum === "undefined") {
    setMessage(
      registrationMessage,
      "No wallet found. Install MetaMask from metamask.io in Chrome, Edge or Brave, " +
        "then reload this page. Preview panes and in-app browsers cannot run wallet extensions.",
      "error"
    );
    showToast("MetaMask is not installed in this browser.", true);
    return;
  }

  if (typeof ethers === "undefined") {
    showToast("Ethers.js did not load. Check your internet connection.", true);
    return;
  }

  try {
    provider = new ethers.providers.Web3Provider(window.ethereum);

    await provider.send("eth_requestAccounts", []);

    signer = provider.getSigner();
    userAccount = await signer.getAddress();

    walletStatus.textContent = shortenAddress(userAccount);

    await showNetwork();

    if (!activeContractAddress) {
      setupPanel.hidden = false;
      showToast("Paste the contract address first. The box is at the top.", true);
      return;
    }

    contract = new ethers.Contract(activeContractAddress, contractABI, signer);

    contractOwner = await contract.owner();

    await refreshEverything();

    connectButton.textContent = "Connected";
    connectButton.disabled = true;
  } catch (error) {
    showToast(explainError(error), true);
  }
}

async function saveContractAddress() {
  const typed = setupAddress.value.trim();

  if (!looksLikeAddress(typed)) {
    setMessage(
      setupMessage,
      "That does not look right. It should start with 0x and be 42 characters long.",
      "error"
    );
    return;
  }

  activeContractAddress = typed;
  try {
    window.localStorage.setItem(STORAGE_KEY, typed);
  } catch (error) {
    // Private modes can block storage. The page still works for this visit.
  }

  contractAddressLabel.textContent = typed;
  setupPanel.hidden = true;
  setMessage(setupMessage, "", "");
  showToast("Contract address saved.");

  if (userAccount && signer && typeof ethers !== "undefined") {
    try {
      contract = new ethers.Contract(activeContractAddress, contractABI, signer);
      contractOwner = await contract.owner();
      await refreshEverything();
    } catch (error) {
      showToast("Address saved, but the contract did not answer.", true);
    }
  }
}

// 11155111 is Sepolia. Anything else is a warning.
async function showNetwork() {  const network = await provider.getNetwork();

  if (network.chainId === 11155111) {
    networkBadge.textContent = "Sepolia";
    networkBadge.classList.add("is-good");
    networkLabel.textContent = "Sepolia testnet (11155111)";
  } else {
    networkBadge.textContent = "Chain " + network.chainId;
    networkBadge.classList.remove("is-good");
    networkLabel.textContent = "Chain id " + network.chainId + " (not Sepolia)";
  }
}

// Fires when the user picks a different account in MetaMask.
if (typeof window.ethereum !== "undefined") {
  window.ethereum.on("accountsChanged", function (accounts) {
    if (accounts.length === 0) {
      walletStatus.textContent = "Wallet not connected";
      contract = null;
      return;
    }

    userAccount = accounts[0];
    walletStatus.textContent = shortenAddress(userAccount);
    refreshEverything();
  });
}

// Only the screen with is-active is shown, so switching never reloads.
function showView(viewId) {
  document.querySelectorAll(".view").forEach(function (view) {
    view.classList.remove("is-active");
  });

  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add("is-active");
  }

  document.querySelectorAll(".tab").forEach(function (tabButton) {
    tabButton.classList.toggle("is-active", tabButton.getAttribute("data-view") === viewId);
  });

  if (viewId === "view-candidates") loadCandidates();
  if (viewId === "view-vote") loadBallot();
  if (viewId === "view-results") loadResults();
  if (viewId === "view-admin") loadAdminPanel();
}

// Reads the chain and redraws whichever screen is open.
async function refreshEverything() {
  if (!contract) return;

  await loadElectionStatus();
  await loadRegistrationStatus();
  await loadCandidates();

  const openView = document.querySelector(".view.is-active");
  if (openView) {
    if (openView.id === "view-vote") await loadBallot();
    if (openView.id === "view-results") await loadResults();
    if (openView.id === "view-admin") await loadAdminPanel();
  }
}

async function loadElectionStatus() {
  if (!contract) return;

  try {
    const isOpen = await contract.getElectionStatus();
    const votes = await contract.getTotalVotes();

    electionStatus.textContent = isOpen ? "Election is OPEN" : "Election is CLOSED";
    electionStatus.classList.toggle("pill-open", isOpen);
    electionStatus.classList.toggle("pill-closed", !isOpen);

    totalVotes.textContent = "Total votes: " + votes.toString();

    adminElectionStatus.textContent = isOpen ? "open" : "closed";
  } catch (error) {
    electionStatus.textContent = "Cannot read the contract";
    electionStatus.classList.add("pill-closed");
  }
}

async function loadRegistrationStatus() {
  if (!contract || !userAccount) return;

  try {
    const status = await contract.getRegistrationStatus(userAccount);

    voterStatus = {
      requested: status.requested,
      authorized: status.authorized,
      voted: status.voted,
      name: status.name,
      studentId: status.studentId,
    };

    regWallet.textContent = userAccount;
    regName.textContent = voterStatus.name || "—";
    regStudentId.textContent = voterStatus.studentId || "—";

    // The three standings, written out in words instead of booleans.
    if (voterStatus.voted) {
      regState.textContent = "Approved, and this wallet has already voted";
      goToVoteButton.hidden = true;
    } else if (voterStatus.authorized) {
      regState.textContent = "Approved. You may vote once.";
      goToVoteButton.hidden = false;
    } else if (voterStatus.requested) {
      regState.textContent = "Waiting for the Electoral Admin to approve this wallet";
      goToVoteButton.hidden = true;
    } else {
      regState.textContent = "Not registered yet";
      goToVoteButton.hidden = true;
    }

    if (contractOwner && userAccount.toLowerCase() === contractOwner.toLowerCase()) {
      adminWallet.textContent = shortenAddress(userAccount) + " (owner)";
    } else {
      adminWallet.textContent = userAccount ? shortenAddress(userAccount) : "—";
    }
  } catch (error) {
    regState.textContent = "Could not read your status";
  }
}

async function loadCandidates() {
  if (!contract) {
    candidateList.innerHTML = '<p class="empty-note">Connect your wallet to load the ballot.</p>';
    return;
  }

  try {
    const isOpen = await contract.getElectionStatus();
    const count = await contract.getCandidateCount();
    const total = Number(count.toString());

    candidateList.innerHTML = "";

    if (total === 0) {
      candidateList.innerHTML = '<p class="empty-note">No candidates have been added yet.</p>';
      candidatesMeta.textContent = "The ballot is empty.";
      return;
    }

    candidatesMeta.textContent =
      total + (total === 1 ? " candidate is" : " candidates are") + " on the ballot.";

    for (let id = 1; id <= total; id++) {
      const candidate = await contract.getCandidate(id);

      candidateList.appendChild(buildCandidateCard(candidate, isOpen));
    }
  } catch (error) {
    candidateList.innerHTML = '<p class="empty-note">Could not load the candidates.</p>';
  }
}

function buildCandidateCard(candidate, isOpen) {
  const card = document.createElement("div");
  card.className = "candidate";

  const name = document.createElement("strong");
  name.textContent = candidate.name;

  const position = document.createElement("span");
  position.className = "candidate-position";
  position.textContent = candidate.position;

  const votes = document.createElement("p");
  votes.className = "candidate-votes";
  votes.innerHTML = "Votes so far: <b>" + candidate.voteCount.toString() + "</b>";

  card.appendChild(name);
  card.appendChild(position);
  card.appendChild(votes);

  if (isOpen) {
    const voteButton = document.createElement("button");
    voteButton.className = "btn btn-ghost btn-small";
    voteButton.type = "button";
    voteButton.textContent = "Vote for " + firstName(candidate.name);

    voteButton.addEventListener("click", function () {
      castVote(candidate.id);
    });

    card.appendChild(voteButton);
  }

  return card;
}

async function loadBallot() {
  if (!contract || !userAccount) {
    ballotList.innerHTML = '<p class="empty-note">Connect your wallet to see the ballot.</p>';
    setMessage(voteNotice, "Connect your wallet to check your voting eligibility.", "info");
    submitVoteButton.disabled = true;
    return;
  }

  try {
    const isOpen = await contract.getElectionStatus();
    const count = Number((await contract.getCandidateCount()).toString());

    if (!isOpen) {
      setMessage(voteNotice, "The election is closed. The results have been released on the Results tab.", "info");
    } else if (!voterStatus.authorized) {
      setMessage(voteNotice, "This wallet is not on the approved voter list yet. Register, then wait for the admin.", "info");
    } else if (voterStatus.voted) {
      setMessage(voteNotice, "This wallet has already used its vote. One wallet, one vote.", "info");
    } else {
      setMessage(voteNotice, "You are approved to vote. Pick one candidate, then confirm.", "ok");
    }

    if (!isOpen || !voterStatus.authorized || voterStatus.voted) {
      ballotList.innerHTML = '<p class="empty-note">The ballot is locked for this wallet.</p>';
      submitVoteButton.disabled = true;
      return;
    }

    if (count === 0) {
      ballotList.innerHTML = '<p class="empty-note">No candidates have been added yet.</p>';
      submitVoteButton.disabled = true;
      return;
    }

    ballotList.innerHTML = "";
    submitVoteButton.disabled = true;
    submitVoteButton.textContent = "Submit my vote";

    for (let id = 1; id <= count; id++) {
      const candidate = await contract.getCandidate(id);
      ballotList.appendChild(buildBallotOption(candidate));
    }
  } catch (error) {
    ballotList.innerHTML = '<p class="empty-note">Could not load the ballot.</p>';
  }
}

function buildBallotOption(candidate) {
  const wrapper = document.createElement("div");

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "ballot";
  radio.id = "ballot-" + candidate.id;
  radio.value = candidate.id.toString();

  radio.addEventListener("change", function () {
    submitVoteButton.disabled = false;
  });

  const label = document.createElement("label");
  label.className = "ballot-option";
  label.setAttribute("for", radio.id);

  const dot = document.createElement("span");
  dot.className = "ballot-dot";

  const text = document.createElement("span");
  text.className = "ballot-text";

  const name = document.createElement("strong");
  name.textContent = candidate.name;

  const position = document.createElement("span");
  position.textContent = candidate.position;

  text.appendChild(name);
  text.appendChild(position);
  label.appendChild(dot);
  label.appendChild(text);

  wrapper.appendChild(radio);
  wrapper.appendChild(label);

  return wrapper;
}

// Sealed while the election is open. The ranking only appears after closing.
async function loadResults() {
  if (!contract) {
    resultsLocked.hidden = false;
    resultsPanel.hidden = true;
    return;
  }

  try {
    const isOpen = await contract.getElectionStatus();
    const total = Number((await contract.getTotalVotes()).toString());
    const approved = Number((await contract.authorizedVoterCount()).toString());
    const count = Number((await contract.getCandidateCount()).toString());

    if (isOpen) {
      resultsLocked.hidden = false;
      resultsPanel.hidden = true;

      resultsLocked.querySelector("p").textContent =
        "The ballot is open. " + total + " of " + approved + " approved voters have voted so far. " +
        "The per candidate breakdown stays hidden until the election is closed.";
      return;
    }

    resultsLocked.hidden = true;
    resultsPanel.hidden = false;

    const rows = [];
    for (let id = 1; id <= count; id++) {
      const candidate = await contract.getCandidate(id);
      rows.push({
        id: candidate.id.toString(),
        name: candidate.name,
        position: candidate.position,
        votes: Number(candidate.voteCount.toString()),
      });
    }

    rows.sort(function (a, b) {
      return b.votes - a.votes;
    });

    if (rows.length > 0 && total > 0) {
      const leader = rows[0];
      winnerName.textContent = leader.name;
      winnerVotes.textContent =
        leader.position + " · " + leader.votes + " of " + total + " votes (" +
        percent(leader.votes, total) + "%)";
    } else if (rows.length > 0) {
      winnerName.textContent = "No votes were cast";
      winnerVotes.textContent = "The election closed with an empty tally.";
    } else {
      winnerName.textContent = "No candidates";
      winnerVotes.textContent = "This election had no candidates.";
    }

    const turnout = approved > 0 ? percent(total, approved) : 0;
    resultsMeta.textContent =
      total + " total " + (total === 1 ? "vote" : "votes") + " from " + approved +
      " approved " + (approved === 1 ? "voter" : "voters") + ". Turnout " + turnout + "%. Official count, election closed.";

    resultsRows.innerHTML = "";
    rows.forEach(function (row, index) {
      const share = total > 0 ? percent(row.votes, total) : 0;

      const rowElement = document.createElement("div");
      rowElement.className = "result-row";

      const rank = document.createElement("span");
      rank.className = "result-rank";
      rank.textContent = index + 1;

      const nameBlock = document.createElement("div");
      nameBlock.className = "result-name";

      const nameLine = document.createElement("strong");
      nameLine.textContent = row.name;

      const positionLine = document.createElement("span");
      positionLine.className = "candidate-position";
      positionLine.textContent = row.position;

      const track = document.createElement("div");
      track.className = "bar-track";

      const fill = document.createElement("div");
      fill.className = "bar-fill";
      // Inline because the width changes with every election.
      fill.style.width = share + "%";

      track.appendChild(fill);
      nameBlock.appendChild(nameLine);
      nameBlock.appendChild(positionLine);
      nameBlock.appendChild(track);

      const countBlock = document.createElement("div");
      countBlock.className = "result-count";
      countBlock.innerHTML = "<b>" + row.votes + "</b>" + share + "%";

      rowElement.appendChild(rank);
      rowElement.appendChild(nameBlock);
      rowElement.appendChild(countBlock);
      resultsRows.appendChild(rowElement);
    });
  } catch (error) {
    resultsLocked.hidden = false;
    resultsPanel.hidden = true;
  }
}

async function loadAdminPanel() {
  if (!contract || !adminLoggedIn) return;

  try {
    const isOpen = await contract.getElectionStatus();
    const queueLength = Number((await contract.getRegistrationQueueLength()).toString());

    const isOwner = contractOwner && userAccount &&
      userAccount.toLowerCase() === contractOwner.toLowerCase();

    startElectionButton.disabled = isOpen || !isOwner;
    endElectionButton.disabled = !isOpen || !isOwner;

    pendingList.innerHTML = "";

    if (queueLength === 0) {
      pendingList.innerHTML = '<p class="empty-note">Nothing pending.</p>';
      return;
    }

    for (let index = 0; index < queueLength; index++) {
      const address = await contract.registrationQueue(index);
      const status = await contract.getRegistrationStatus(address);

      if (status.authorized) continue;

      pendingList.appendChild(buildPendingRow(address, status.name, status.studentId));
    }

    if (pendingList.innerHTML === "") {
      pendingList.innerHTML = '<p class="empty-note">Every registration has been approved.</p>';
    }
  } catch (error) {
    pendingList.innerHTML = '<p class="empty-note">Could not read the pending list.</p>';
  }
}

function buildPendingRow(address, name, studentId) {
  const row = document.createElement("div");
  row.className = "pending-item";

  const info = document.createElement("div");
  info.className = "pending-info";

  const nameLine = document.createElement("strong");
  nameLine.textContent = name || "Unnamed request";

  const detailLine = document.createElement("span");
  detailLine.textContent = (studentId ? studentId + " · " : "") + address;

  info.appendChild(nameLine);
  info.appendChild(detailLine);

  const approveButton = document.createElement("button");
  approveButton.className = "btn btn-primary btn-small";
  approveButton.type = "button";
  approveButton.textContent = "Approve";

  approveButton.addEventListener("click", function () {
    approveVoter(address);
  });

  row.appendChild(info);
  row.appendChild(approveButton);

  return row;
}

async function submitRegistration() {
  if (!contract || !userAccount) {
    setMessage(registrationMessage, "Connect your wallet before registering.", "error");
    return;
  }

  const name = registerName.value.trim();
  const studentId = registerStudentId.value.trim();

  if (name === "") {
    setMessage(registrationMessage, "Please type your full name.", "error");
    return;
  }

  if (voterStatus.authorized) {
    setMessage(registrationMessage, "This wallet is already approved. You do not need to register again.", "ok");
    return;
  }

  setMessage(registrationMessage, "Waiting for MetaMask confirmation...", "info");

  try {
    const transaction = await contract.requestVoterRegistration(name, studentId);

    await transaction.wait();

    setMessage(registrationMessage, "Registration submitted. The Electoral Admin will review it.", "ok");
    showToast("Registration submitted on chain.");

    registerForm.reset();
    await loadRegistrationStatus();
  } catch (error) {
    setMessage(registrationMessage, explainError(error), "error");
  }
}

async function castVote(candidateId) {
  if (!contract) return;

  if (!voterStatus.authorized) {
    showToast("This wallet is not approved to vote yet.", true);
    return;
  }

  if (voterStatus.voted) {
    showToast("This wallet has already voted.", true);
    return;
  }

  try {
    const transaction = await contract.vote(candidateId);
    await transaction.wait();

    showToast("Vote recorded on chain.");
    await refreshEverything();
  } catch (error) {
    showToast(explainError(error), true);
  }
}

async function submitVote() {
  const selected = document.querySelector('input[name="ballot"]:checked');

  if (!selected) {
    setMessage(voteMessage, "Pick a candidate first.", "error");
    return;
  }

  submitVoteButton.disabled = true;
  submitVoteButton.textContent = "Confirming in MetaMask...";
  setMessage(voteMessage, "", "");

  try {
    const transaction = await contract.vote(selected.value);
    await transaction.wait();

    setMessage(voteMessage, "Vote recorded. Thank you for taking part.", "ok");
    showToast("Vote recorded on chain.");

    await refreshEverything();
    await loadBallot();
    await loadElectionStatus();
  } catch (error) {
    setMessage(voteMessage, explainError(error), "error");
    submitVoteButton.textContent = "Submit my vote";
    submitVoteButton.disabled = false;
  }
}

// The premade Commission on Elections account.
function adminLogin() {
  const username = adminUsername.value.trim();
  const password = adminPassword.value;

  if (username === "" || password === "") {
    setMessage(adminLoginMessage, "Fill in both fields.", "error");
    return;
  }

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    setMessage(adminLoginMessage, "Wrong username or password.", "error");
    return;
  }

  adminLoggedIn = true;
  adminPassword.value = "";
  setMessage(adminLoginMessage, "", "");
  showView("view-admin");
  showToast("Signed in as Electoral Admin.");
}

async function addCandidate() {
  if (!contract) {
    setMessage(adminMessage, "Connect the owner wallet first.", "error");
    return;
  }

  const name = candidateName.value.trim();
  const position = candidatePosition.value.trim();

  if (name === "" || position === "") {
    setMessage(adminMessage, "Both the name and the position are required.", "error");
    return;
  }

  setMessage(adminMessage, "Waiting for MetaMask confirmation...", "info");

  try {
    const transaction = await contract.addCandidate(name, position);
    await transaction.wait();

    setMessage(adminMessage, "Candidate added: " + name, "ok");
    showToast("Candidate added.");
    addCandidateForm.reset();

    await loadCandidates();
    await loadAdminPanel();
  } catch (error) {
    setMessage(adminMessage, explainError(error), "error");
  }
}

async function approveVoter(address) {
  if (!contract) {
    setMessage(adminMessage, "Connect the owner wallet first.", "error");
    return;
  }

  setMessage(adminMessage, "Waiting for MetaMask confirmation...", "info");

  try {
    const transaction = await contract.authorizeVoter(address);
    await transaction.wait();

    setMessage(adminMessage, "Approved " + shortenAddress(address) + " as a voter.", "ok");
    showToast("Voter approved.");
    await loadAdminPanel();
  } catch (error) {
    setMessage(adminMessage, explainError(error), "error");
  }
}

function authorizeVoter() {
  const address = voterAddress.value.trim();

  if (!ethers.utils.isAddress(address)) {
    setMessage(adminMessage, "That does not look like a wallet address.", "error");
    return;
  }

  approveVoter(address);
  voterAddress.value = "";
}

async function startElection() {
  if (!contract) return;

  setMessage(adminMessage, "Waiting for MetaMask confirmation...", "info");

  try {
    const transaction = await contract.startElection();
    await transaction.wait();

    setMessage(adminMessage, "Voting is now open. Candidates and the voter list are locked.", "ok");
    showToast("Election started.");
    await refreshEverything();
    await loadAdminPanel();
  } catch (error) {
    setMessage(adminMessage, explainError(error), "error");
  }
}

async function endElection() {
  if (!contract) return;

  const sure = window.confirm("Close the election? No further votes will be accepted.");
  if (!sure) return;

  setMessage(adminMessage, "Waiting for MetaMask confirmation...", "info");

  try {
    const transaction = await contract.endElection();
    await transaction.wait();

    setMessage(adminMessage, "Election closed. The official results are now public.", "ok");
    showToast("Election closed.");
    await refreshEverything();
    await loadAdminPanel();
  } catch (error) {
    setMessage(adminMessage, explainError(error), "error");
  }
}

// Helpers.
function shortenAddress(address) {
  if (!address) return "—";
  return address.slice(0, 6) + "..." + address.slice(-4);
}

function firstName(fullName) {
  return (fullName || "candidate").split(" ")[0];
}

function percent(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function setMessage(element, text, type) {
  if (!element) return;

  element.textContent = text;
  element.className = "message";

  if (type) {
    element.classList.add("message-" + type);
  }
}

function showToast(text, isError) {
  toast.textContent = text;
  toast.classList.toggle("is-error", Boolean(isError));
  toast.hidden = false;

  // Clear the old timer so two quick clicks do not cut each other off.
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(function () {
    toast.hidden = true;
  }, isError ? 4200 : 2800);
}

// MetaMask hides the real reason a few layers deep.
function explainError(error) {
  let raw = "";

  if (error && error.error && error.error.message) raw = error.error.message;
  else if (error && error.data && error.data.message) raw = error.data.message;
  else if (error && error.reason) raw = error.reason;
  else if (error && error.message) raw = error.message;

  if (raw === "") return "The transaction did not go through.";

  raw = raw.replace("execution reverted: ", "").replace("MetaMask Tx Signature: ", "");

  if (raw.length > 160) {
    raw = raw.slice(0, 160) + "...";
  }

  return raw;
}
