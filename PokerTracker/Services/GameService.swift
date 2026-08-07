import Foundation
import FirebaseFirestore

enum GameServiceError: LocalizedError {
    case gameNotFound
    case gameAlreadyEnded
    case codeGenerationFailed

    var errorDescription: String? {
        switch self {
        case .gameNotFound:
            return "No game found with that code. Double-check and try again."
        case .gameAlreadyEnded:
            return "This game has already ended."
        case .codeGenerationFailed:
            return "Couldn't generate a unique game code. Please try again."
        }
    }
}

final class GameService {
    static let shared = GameService()
    private let db = Firestore.firestore()
    private init() {}

    private func gameRef(_ code: String) -> DocumentReference {
        db.collection("games").document(code)
    }

    private func playersRef(_ code: String) -> CollectionReference {
        gameRef(code).collection("players")
    }

    func createGame(name: String, hostUid: String, hostName: String, defaultBuyIn: Double) async throws -> PokerGame {
        for _ in 0..<8 {
            let code = GameCodeGenerator.generate()
            let ref = gameRef(code)
            let snapshot = try await ref.getDocument()
            if snapshot.exists { continue }

            let game = PokerGame(
                code: code,
                name: name.trimmingCharacters(in: .whitespaces).isEmpty ? "Poker Night" : name,
                hostId: hostUid,
                defaultBuyIn: defaultBuyIn
            )
            try await ref.setData(game.dictionary)

            let player = GamePlayer(uid: hostUid, name: hostName, buyIns: [BuyIn(amount: defaultBuyIn)])
            try await playersRef(code).document(hostUid).setData(player.dictionary)

            return game
        }
        throw GameServiceError.codeGenerationFailed
    }

    func joinGame(code: String, uid: String, name: String) async throws -> PokerGame {
        let upperCode = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let snapshot = try await gameRef(upperCode).getDocument()
        guard snapshot.exists, let data = snapshot.data(), let game = PokerGame(code: upperCode, data: data) else {
            throw GameServiceError.gameNotFound
        }
        guard game.status == .active else {
            throw GameServiceError.gameAlreadyEnded
        }

        let playerRef = playersRef(upperCode).document(uid)
        let existing = try await playerRef.getDocument()
        if !existing.exists {
            let player = GamePlayer(uid: uid, name: name, buyIns: [BuyIn(amount: game.defaultBuyIn)])
            try await playerRef.setData(player.dictionary)
        }
        return game
    }

    func fetchGameWithPlayers(code: String) async throws -> (PokerGame, [GamePlayer]) {
        let upperCode = code.uppercased()
        let snapshot = try await gameRef(upperCode).getDocument()
        guard snapshot.exists, let data = snapshot.data(), let game = PokerGame(code: upperCode, data: data) else {
            throw GameServiceError.gameNotFound
        }
        let playersSnapshot = try await playersRef(upperCode).getDocuments()
        let players = playersSnapshot.documents.compactMap { GamePlayer(uid: $0.documentID, data: $0.data()) }
        return (game, players)
    }

    func listenToGame(code: String, onChange: @escaping (PokerGame?) -> Void) -> ListenerRegistration {
        gameRef(code).addSnapshotListener { snapshot, _ in
            guard let snapshot, snapshot.exists, let data = snapshot.data() else {
                onChange(nil)
                return
            }
            onChange(PokerGame(code: code, data: data))
        }
    }

    func listenToPlayers(code: String, onChange: @escaping ([GamePlayer]) -> Void) -> ListenerRegistration {
        playersRef(code).addSnapshotListener { snapshot, _ in
            guard let documents = snapshot?.documents else {
                onChange([])
                return
            }
            let players = documents
                .compactMap { GamePlayer(uid: $0.documentID, data: $0.data()) }
                .sorted { $0.joinedAt < $1.joinedAt }
            onChange(players)
        }
    }

    func addBuyIn(code: String, playerUid: String, amount: Double) async throws {
        let buyIn = BuyIn(amount: amount)
        try await playersRef(code).document(playerUid).updateData([
            "buyIns": FieldValue.arrayUnion([buyIn.dictionary])
        ])
    }

    func setCashOut(code: String, playerUid: String, amount: Double) async throws {
        try await playersRef(code).document(playerUid).updateData([
            "cashOut": amount
        ])
    }

    func endGame(code: String) async throws {
        try await gameRef(code).updateData([
            "status": PokerGame.Status.ended.rawValue,
            "endedAt": Timestamp(date: Date())
        ])
    }
}
