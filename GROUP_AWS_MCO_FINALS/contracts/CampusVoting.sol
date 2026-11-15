// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

// One election per deployment. The wallet that deploys it becomes the owner.
contract CampusVoting is Ownable {
    // A candidate is one row on the ballot.
    struct Candidate {
        uint256 id;
        string name;
        string position;
        uint256 voteCount;
        bool exists;
    }

    uint256 public candidateCount;
    uint256 public totalVotes;
    bool public electionOpen;
    uint256 public authorizedVoterCount;

    // id -> candidate
    mapping(uint256 => Candidate) public candidates;

    // wallet -> allowed to vote
    mapping(address => bool) public authorizedVoters;

    // wallet -> already used its one vote
    mapping(address => bool) public hasVoted;

    // what the voter typed on the registration form
    mapping(address => string) public voterName;
    mapping(address => string) public voterStudentId;

    // wallet -> already asked to register
    mapping(address => bool) public registrationRequested;

    // the pending list, kept as an array so the admin panel can loop over it
    address[] public registrationQueue;

    event CandidateAdded(uint256 indexed candidateId, string name);
    event VoterAuthorized(address indexed voter);
    event VoterRegistrationRequested(address indexed voter, string name);
    event VoteCast(address indexed voter, uint256 indexed candidateId);
    event ElectionStatusChanged(bool isOpen);

    // Runs once, at deployment.
    constructor() Ownable(msg.sender) {
        // Closed until the admin says otherwise.
        electionOpen = false;
    }

    // Admin only, and only before voting starts.
    function addCandidate(
        string calldata _name,
        string calldata _position
    ) external onlyOwner {
        require(bytes(_name).length > 0, "Candidate name is required");
        require(!electionOpen, "Cannot add candidates after election starts");

        candidateCount++;

        candidates[candidateCount] = Candidate({
            id: candidateCount,
            name: _name,
            position: _position,
            voteCount: 0,
            exists: true
        });

        emit CandidateAdded(candidateCount, _name);
    }

    // Admin only. This is how a voter gets on the official list.
    function authorizeVoter(address _voter) external onlyOwner {
        require(_voter != address(0), "Invalid voter address");
        require(!electionOpen, "Cannot authorize voters after election starts");

        // Only count a wallet the first time it is approved.
        if (!authorizedVoters[_voter]) {
            authorizedVoterCount++;
        }
        authorizedVoters[_voter] = true;

        emit VoterAuthorized(_voter);
    }

    // Admin only. Opens the ballot.
    function startElection() external onlyOwner {
        // A one candidate race is not a race.
        require(candidateCount >= 2, "Add at least two candidates");
        require(!electionOpen, "Election is already open");

        electionOpen = true;

        emit ElectionStatusChanged(true);
    }

    // Admin only. Freezes the count for good.
    function endElection() external onlyOwner {
        require(electionOpen, "Election is not open");

        electionOpen = false;

        emit ElectionStatusChanged(false);
    }

    // A voter asks to be added. The admin still has to approve.
    function requestVoterRegistration(
        string calldata _name,
        string calldata _studentId
    ) external {
        require(!authorizedVoters[msg.sender], "Already registered");
        require(!electionOpen, "Registration is closed");
        require(bytes(_name).length > 0, "Full name is required");

        voterName[msg.sender] = _name;
        voterStudentId[msg.sender] = _studentId;

        // Queue the wallet on the first request only.
        if (!registrationRequested[msg.sender]) {
            registrationRequested[msg.sender] = true;
            registrationQueue.push(msg.sender);
        }

        emit VoterRegistrationRequested(msg.sender, _name);
    }

    // One vote per approved wallet, and only while the election is open.
    function vote(uint256 _candidateId) external {
        require(electionOpen, "Election is not open");
        require(authorizedVoters[msg.sender], "You are not authorized to vote");
        require(!hasVoted[msg.sender], "You have already voted");

        // Without this check, id 99 would count as an empty candidate.
        require(candidates[_candidateId].exists, "Invalid candidate");

        hasVoted[msg.sender] = true;
        candidates[_candidateId].voteCount++;
        totalVotes++;

        emit VoteCast(msg.sender, _candidateId);
    }

    // Returns the five fields flat so the frontend can read them by name.
    function getCandidate(
        uint256 _candidateId
    )
        external
        view
        returns (
            uint256 id,
            string memory name,
            string memory position,
            uint256 voteCount,
            bool exists
        )
    {
        require(candidates[_candidateId].exists, "Invalid candidate");

        Candidate memory chosen = candidates[_candidateId];

        return (chosen.id, chosen.name, chosen.position, chosen.voteCount, chosen.exists);
    }

    function getCandidateCount() external view returns (uint256) {
        return candidateCount;
    }

    function getTotalVotes() external view returns (uint256) {
        return totalVotes;
    }

    function getElectionStatus() external view returns (bool) {
        return electionOpen;
    }

    // One call for everything the voter status card needs.
    function getRegistrationStatus(
        address _voter
    )
        external
        view
        returns (
            bool requested,
            bool authorized,
            bool voted,
            string memory name,
            string memory studentId
        )
    {
        return (
            registrationRequested[_voter],
            authorizedVoters[_voter],
            hasVoted[_voter],
            voterName[_voter],
            voterStudentId[_voter]
        );
    }

    function getRegistrationQueueLength() external view returns (uint256) {
        return registrationQueue.length;
    }
}
