package app

import (
	"context"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/bodyapi"
	"github.com/D0bby999/anytools/internal/body"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_body.go assembles Body: the training log and its coach, which runs on
// the learner's chat route (the private design notes).

func buildBody(pool *pg.Pool, byokService *byok.Service) *bodyapi.Handler {
	users := pg.NewUserStore(pool)
	store := pg.NewBodyStore(pool)
	svc := body.NewService(store, users, nil)
	coach := body.NewCoach(svc, store, newChatResolver(byokService), userLanguages{users})
	return bodyapi.NewHandler(svc, coach)
}

// userLanguages reads the learner's interface language, the language the
// coach writes in.
type userLanguages struct{ users *pg.UserStore }

// Language implements body.Languages.
func (u userLanguages) Language(ctx context.Context, userID uuid.UUID) (string, error) {
	user, err := u.users.GetUser(ctx, userID)
	if err != nil {
		return "", err
	}
	return user.Language, nil
}
